import { randomUUID } from "node:crypto";
import {
  AGE_CONFIRMATION_TEXT_VERSION_ID,
  AGE_GATE_REFUSAL_MESSAGE,
  age16ConfirmedSchema,
  isCurrentSignUpAttestationTextVersion,
  SIGN_UP_ATTESTATION_REFUSAL_MESSAGE,
  SIGN_UP_ATTESTATION_TEXT_VERSION,
} from "@bjj-roll/shared";
import { APIError } from "better-auth/api";
import { sql } from "kysely";
import type { Pool, PoolClient } from "pg";
import { MAGIC_LINK_EXPIRY_SECONDS, OTP_EXPIRY_SECONDS } from "./authLimits.js";
import type { AuthCryptoCodec } from "./authSecrets.js";
import { applyScopeSettings, emptyScopeSettings, type AuthTransaction } from "./authSessionScope.js";

/**
 * HEN-263 (replaces the HEN-77 send-time refusal): every sign-in send gets the same answer, so a send never tells whether an
 * email has an account. The age answers ride along as a pending verification row keyed by the email HMAC, and the check runs
 * where the account is created: when the code is used or the link is opened. A refusal happens on those verify paths, so it
 * never adds to the per-IP or per-email send counters; guessing there stays under the documented verify limit (20 / IP / 15 min).
 * HEN-183: the sign-up attestation (the text version id the app showed) rides along the same way and is checked in the same place,
 * after the 16+ tick. Only the current text version passes; it becomes an attestation_signup record in the same user transaction.
 */
const PENDING_IDENTIFIER_PREFIX = "age-confirmation-";
const PENDING_EXPIRY_SECONDS = Math.max(OTP_EXPIRY_SECONDS, MAGIC_LINK_EXPIRY_SECONDS);

/** What a send (or a social sign-in) answered: the age ticks and the attestation text version id, if it was the current one. */
export interface PendingSignUpAnswers {
  readonly age16Confirmed: boolean;
  readonly age18Confirmed: boolean;
  readonly signUpAttestationTextVersionId: string | null;
}

/** The answers a new account needs: 16+ ticked and the current attestation accepted. */
interface AcceptedSignUpAnswers {
  readonly age16Confirmed: true;
  readonly age18Confirmed: boolean;
  readonly signUpAttestationTextVersionId: string;
}

function readSignUpAnswers(source: unknown): PendingSignUpAnswers {
  const signUpAttestationTextVersionId = readRecordField(source, "signUpAttestationTextVersionId");
  return {
    age16Confirmed: age16ConfirmedSchema.safeParse(readRecordField(source, "age16Confirmed")).success,
    age18Confirmed: readRecordField(source, "age18Confirmed") === true,
    signUpAttestationTextVersionId: isCurrentSignUpAttestationTextVersion(signUpAttestationTextVersionId)
      ? SIGN_UP_ATTESTATION_TEXT_VERSION.id
      : null,
  };
}

/** The age refusal comes first (HEN-263 unchanged); a ticked 16+ without the current attestation gets the attestation refusal. */
function requireAcceptedSignUpAnswers(answers: PendingSignUpAnswers | null): AcceptedSignUpAnswers {
  if (!answers?.age16Confirmed) {
    throw ageConfirmationRequiredError();
  }
  if (answers.signUpAttestationTextVersionId === null) {
    throw signUpAttestationRequiredError();
  }
  return { age16Confirmed: true, age18Confirmed: answers.age18Confirmed, signUpAttestationTextVersionId: answers.signUpAttestationTextVersionId };
}

/** Only the email-OTP "sign-in" type and magic-link sign-in can create users. */
export function isAccountCreatingSend(path: string, body: unknown): body is Record<string, unknown> & { email: string } {
  if (typeof body !== "object" || body === null) {
    return false;
  }
  const bodyRecord = body as Record<string, unknown>;
  const canCreateUser = path === "/sign-in/magic-link" || (path === "/email-otp/send-verification-otp" && bodyRecord.type === "sign-in");
  return canCreateUser && typeof bodyRecord.email === "string" && bodyRecord.email.includes("@");
}

export function ageConfirmationRequiredError(): APIError {
  return new APIError("BAD_REQUEST", { code: "AGE_CONFIRMATION_REQUIRED", message: AGE_GATE_REFUSAL_MESSAGE });
}

export function signUpAttestationRequiredError(): APIError {
  return new APIError("BAD_REQUEST", { code: "SIGN_UP_ATTESTATION_REQUIRED", message: SIGN_UP_ATTESTATION_REFUSAL_MESSAGE });
}

function pendingIdentifier(codec: AuthCryptoCodec, email: string): string {
  return `${PENDING_IDENTIFIER_PREFIX}${codec.computeEmailHmac(email)}`;
}

/** One bjj_app transaction with exact-key RLS settings; nothing here can see another email's or user's rows. */
async function withAppRole<Result>(
  pool: Pool,
  settings: { verificationIdentifier: string; userId?: string },
  operation: (client: PoolClient) => Promise<Result>,
): Promise<Result> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE bjj_app");
    await client.query("SELECT set_config('app.verification_identifier', $1, true), set_config('app.user_id', $2, true)", [
      settings.verificationIdentifier,
      settings.userId ?? "",
    ]);
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Same work for every email: drop any earlier pending answer, then store this send's answer, ticked or not, so a send that will
 * be refused runs the same SQL as one that will not. The latest send wins, so an unticked resend withdraws an earlier tick.
 * Known emails get the row too (linked to the user so it goes with the account). HEN-183: after their sign-in, its attestation
 * answer becomes their acceptance record (refreshSignUpAttestationAfterSignIn), then the row is deleted.
 * HEN-183: the attestation text version id is stored with the age answers (null unless it is the current version).
 */
export async function recordPendingAgeAnswers(pool: Pool, codec: AuthCryptoCodec, body: Record<string, unknown> & { email: string }): Promise<void> {
  const identifier = pendingIdentifier(codec, body.email);
  const answers = readSignUpAnswers(body);
  await withAppRole(pool, { verificationIdentifier: identifier }, async (client) => {
    await client.query("DELETE FROM public.verifications WHERE identifier = $1", [identifier]);
    const now = new Date();
    await client.query(
      `INSERT INTO public.verifications (id, user_id, identifier, value, expires_at, created_at, updated_at)
       VALUES ($1, public.app_user_id_by_email_hmac($2), $3, $4, $5, $6, $6)`,
      [
        randomUUID(),
        codec.computeEmailHmac(body.email),
        identifier,
        codec.encryptVerificationPayload(JSON.stringify(answers)),
        new Date(now.getTime() + PENDING_EXPIRY_SECONDS * 1000),
        now,
      ],
    );
  });
}

function decodePendingAgeAnswers(codec: AuthCryptoCodec, value: string | undefined): PendingSignUpAnswers | null {
  return value === undefined ? null : readSignUpAnswers(JSON.parse(codec.decryptVerificationPayload(value)));
}

async function selectPendingAgeAnswers(client: PoolClient, codec: AuthCryptoCodec, identifier: string): Promise<PendingSignUpAnswers | null> {
  const result = await client.query<{ value: string }>("SELECT value FROM public.verifications WHERE identifier = $1 AND expires_at > $2", [
    identifier,
    new Date(), // the app clock, like Better Auth's own expiry checks
  ]);
  return decodePendingAgeAnswers(codec, result.rows[0]?.value);
}

/** Before the user row is written: refuse unless this email's latest send carried the 16+ tick and the current attestation. */
export async function assertPendingAgeConfirmation(pool: Pool, codec: AuthCryptoCodec, email: string): Promise<void> {
  const identifier = pendingIdentifier(codec, email);
  const answers = await withAppRole(pool, { verificationIdentifier: identifier }, (client) => selectPendingAgeAnswers(client, codec, identifier));
  requireAcceptedSignUpAnswers(answers);
}

/**
 * Inside the transaction that inserts the user row (Sara, 26 Oct): move the pending answers onto the user's age_confirmation
 * consent record, and (HEN-183) the accepted attestation text version onto an attestation_signup record. If anything here
 * fails, the user row rolls back with it, so there is never an account without its records.
 */
export async function storeAgeConfirmationInUserTransaction(
  transaction: AuthTransaction,
  codec: AuthCryptoCodec,
  user: { id: string; email: string },
): Promise<void> {
  const identifier = pendingIdentifier(codec, user.email);
  await applyScopeSettings(transaction, { ...emptyScopeSettings(), userId: user.id, verificationIdentifier: identifier });
  const pending = await sql<{ value: string }>`SELECT value FROM public.verifications
    WHERE identifier = ${identifier} AND expires_at > ${new Date()}`.execute(transaction);
  const pendingAnswers = decodePendingAgeAnswers(codec, pending.rows[0]?.value);
  await sql`DELETE FROM public.verifications WHERE identifier = ${identifier}`.execute(transaction);
  const { age16Confirmed, age18Confirmed, signUpAttestationTextVersionId } = requireAcceptedSignUpAnswers(pendingAnswers);
  await sql`INSERT INTO public.consent_records (id, user_id, consent_type, text_version_id, age16_confirmed, age18_confirmed)
    VALUES (${randomUUID()}, ${user.id}, 'age_confirmation', ${AGE_CONFIRMATION_TEXT_VERSION_ID}, ${age16Confirmed}, ${age18Confirmed})`.execute(
    transaction,
  );
  await sql`INSERT INTO public.consent_records (id, user_id, consent_type, text_version_id)
    VALUES (${randomUUID()}, ${user.id}, 'attestation_signup', ${signUpAttestationTextVersionId})`.execute(transaction);
}

/** What the user-create hook knows about an Apple or Google sign-up: not social at all, or social with its answers (null = no 16+ tick). */
export type SocialSignUpAgeAnswers = { readonly social: false } | { readonly social: true; readonly answers: PendingSignUpAnswers | null };

/**
 * HEN-239: Apple or Google sign-in may create a user only with the same 16+ tick as email sign-up (HEN-263), and sends the 18+
 * answer (and, HEN-183, the attestation text version id) the same way. The native token path reads them from the request body;
 * the browser path from the OAuth state saved when the flow started. An existing user (found by provider account or linked by
 * verified email) never reaches the user-create hook.
 */
export function readSocialSignUpAgeAnswers(path: string | undefined, body: unknown, oauthStateAdditionalData: unknown): SocialSignUpAgeAnswers {
  if (path === "/sign-in/social") {
    return { social: true, answers: readSocialSignUpAnswers(readRecordField(body, "additionalData")) };
  }
  if (path?.startsWith("/callback/")) {
    return { social: true, answers: readSocialSignUpAnswers(oauthStateAdditionalData) };
  }
  return { social: false };
}

function readRecordField(source: unknown, field: string): unknown {
  return typeof source === "object" && source !== null ? (source as Record<string, unknown>)[field] : undefined;
}

function readSocialSignUpAnswers(source: unknown): PendingSignUpAnswers | null {
  const answers = readSignUpAnswers(source);
  return answers.age16Confirmed ? answers : null;
}

/**
 * The user-create hook. Email sign-up needs the 16+ tick and the current attestation from this email's latest send.
 * Social sign-up has no send, so its own accepted answers are stored as the pending row for the provider's email,
 * and the user insert moves them onto the consent records.
 */
export async function assertSignUpAgeConfirmation(
  pool: Pool,
  codec: AuthCryptoCodec,
  { email, social }: { readonly email: string; readonly social: SocialSignUpAgeAnswers },
): Promise<void> {
  if (!social.social) {
    await assertPendingAgeConfirmation(pool, codec, email);
    return;
  }
  await recordPendingAgeAnswers(pool, codec, { email, ...requireAcceptedSignUpAnswers(social.answers) });
}

const EMAIL_SIGN_IN_PATHS: ReadonlySet<string> = new Set(["/sign-in/email-otp", "/magic-link/verify"]);

/** What a finished sign-in knows: its path, the session's user, the request body and (browser social flow) the OAuth state. */
export interface FinishedSignIn {
  readonly path: string;
  readonly user: { readonly id: string; readonly email: string };
  readonly body: unknown;
  readonly oauthState: unknown;
}

/**
 * HEN-183 (Sara, 27 Oct): the duties tick on the sign-in screen also counts for an existing account, so it is not asked again
 * right after sign-in. This runs after a sign-in made a session, so the send's answer never depends on whether the account exists.
 * Email sign-in uses the answers its latest send stored (every email stores them); Apple and Google use the ones sent with the
 * sign-in. Only the current text version counts, and an account that already accepted it gets no second row. A new account got
 * its record in the user transaction and its pending row is gone, so nothing is added for it.
 */
export async function refreshSignUpAttestationAfterSignIn(pool: Pool, codec: AuthCryptoCodec, signIn: FinishedSignIn): Promise<void> {
  const social = readSocialSignUpAgeAnswers(signIn.path, signIn.body, signIn.oauthState);
  if (!social.social && !EMAIL_SIGN_IN_PATHS.has(signIn.path)) {
    return;
  }
  const identifier = pendingIdentifier(codec, signIn.user.email);
  await withAppRole(pool, { verificationIdentifier: identifier, userId: signIn.user.id }, async (client) => {
    let textVersionId: string | null;
    if (social.social) {
      textVersionId = readSignUpAnswers(
        signIn.path === "/sign-in/social" ? readRecordField(signIn.body, "additionalData") : signIn.oauthState,
      ).signUpAttestationTextVersionId;
    } else {
      textVersionId = (await selectPendingAgeAnswers(client, codec, identifier))?.signUpAttestationTextVersionId ?? null;
      await client.query("DELETE FROM public.verifications WHERE identifier = $1", [identifier]);
    }
    if (textVersionId === null) {
      return;
    }
    await client.query(
      `INSERT INTO public.consent_records (id, user_id, consent_type, text_version_id)
       SELECT $1, $2, 'attestation_signup', $3
       WHERE NOT EXISTS (SELECT 1 FROM public.consent_records
         WHERE user_id = $2 AND consent_type = 'attestation_signup' AND text_version_id = $3 AND withdrawn_at IS NULL)`,
      [randomUUID(), signIn.user.id, textVersionId],
    );
  });
}
