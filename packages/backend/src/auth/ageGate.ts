import { randomUUID } from "node:crypto";
import {
  AGE_CONFIRMATION_TEXT_VERSION_ID,
  AGE_GATE_REFUSAL_MESSAGE,
  age16ConfirmedSchema,
  isCurrentSignUpAttestationTextVersion,
  SIGN_UP_ATTESTATION_REFUSAL_MESSAGE,
  signUpAttestationVersion,
} from "@bjj-roll/shared";
import { APIError } from "better-auth/api";
import { sql } from "kysely";
import type { Pool, PoolClient } from "pg";
import { MAGIC_LINK_EXPIRY_SECONDS, OTP_EXPIRY_SECONDS } from "./authLimits.js";
import type { AuthCryptoCodec } from "./authSecrets.js";
import { applyScopeSettings, emptyScopeSettings, type AuthTransaction } from "./authSessionScope.js";
import { currentDate, secondsAfter } from "../dates.js";
import { withPoolTransaction } from "../database/connection.js";

const PENDING_IDENTIFIER_PREFIX = "age-confirmation-";
const PENDING_EXPIRY_SECONDS = Math.max(OTP_EXPIRY_SECONDS, MAGIC_LINK_EXPIRY_SECONDS);

interface PendingSignUpAnswers {
  readonly age16Confirmed: boolean;
  readonly age18Confirmed: boolean;
  readonly signUpAttestationTextVersionId: string | null;
}

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
    signUpAttestationTextVersionId: isCurrentSignUpAttestationTextVersion(signUpAttestationTextVersionId) ? signUpAttestationVersion.id : null,
  };
}

function requireAcceptedSignUpAnswers(answers: PendingSignUpAnswers | null): AcceptedSignUpAnswers {
  if (!answers?.age16Confirmed) {
    throw ageConfirmationRequiredError();
  }
  if (answers.signUpAttestationTextVersionId === null) {
    throw signUpAttestationRequiredError();
  }
  return { age16Confirmed: true, age18Confirmed: answers.age18Confirmed, signUpAttestationTextVersionId: answers.signUpAttestationTextVersionId };
}

export function isAccountCreatingSend(path: string, body: unknown): body is Record<string, unknown> & { email: string } {
  if (typeof body !== "object" || body === null) {
    return false;
  }
  const bodyRecord = body as Record<string, unknown>;
  const canCreateUser = path === "/sign-in/magic-link" || (path === "/email-otp/send-verification-otp" && bodyRecord.type === "sign-in");
  return canCreateUser && typeof bodyRecord.email === "string" && bodyRecord.email.includes("@");
}

function ageConfirmationRequiredError(): APIError {
  return new APIError("BAD_REQUEST", { code: "AGE_CONFIRMATION_REQUIRED", message: AGE_GATE_REFUSAL_MESSAGE });
}

function signUpAttestationRequiredError(): APIError {
  return new APIError("BAD_REQUEST", { code: "SIGN_UP_ATTESTATION_REQUIRED", message: SIGN_UP_ATTESTATION_REFUSAL_MESSAGE });
}

function pendingIdentifier(codec: AuthCryptoCodec, email: string): string {
  return `${PENDING_IDENTIFIER_PREFIX}${codec.computeEmailHmac(email)}`;
}

function withAppRole<Result>(
  pool: Pool,
  settings: { verificationIdentifier: string; userId?: string },
  operation: (client: PoolClient) => Promise<Result>,
): Promise<Result> {
  return withPoolTransaction(pool, async (client) => {
    await client.query("SET LOCAL ROLE bjj_app");
    await client.query("SELECT set_config('app.verification_identifier', $1, true), set_config('app.user_id', $2, true)", [
      settings.verificationIdentifier,
      settings.userId ?? "",
    ]);
    const result = await operation(client);
    return result;
  });
}

export async function recordPendingAgeAnswers(pool: Pool, codec: AuthCryptoCodec, body: Record<string, unknown> & { email: string }): Promise<void> {
  const identifier = pendingIdentifier(codec, body.email);
  const answers = readSignUpAnswers(body);
  await withAppRole(pool, { verificationIdentifier: identifier }, async (client) => {
    await client.query("DELETE FROM public.verifications WHERE identifier = $1", [identifier]);
    const now = currentDate();
    await client.query(
      `INSERT INTO public.verifications (id, user_id, identifier, value, email_hash, expires_at, created_at, updated_at)
       VALUES ($1, public.app_user_id_by_email_hmac($2), $3, $4, $2, $5, $6, $6)`,
      [
        randomUUID(),
        codec.computeEmailHmac(body.email),
        identifier,
        codec.encryptVerificationPayload(JSON.stringify(answers)),
        secondsAfter(now, PENDING_EXPIRY_SECONDS),
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
    currentDate(),
  ]);
  return decodePendingAgeAnswers(codec, result.rows[0]?.value);
}

async function assertPendingAgeConfirmation(pool: Pool, codec: AuthCryptoCodec, email: string): Promise<void> {
  const identifier = pendingIdentifier(codec, email);
  const answers = await withAppRole(pool, { verificationIdentifier: identifier }, (client) => selectPendingAgeAnswers(client, codec, identifier));
  requireAcceptedSignUpAnswers(answers);
}

export async function storeAgeConfirmationInUserTransaction(
  transaction: AuthTransaction,
  codec: AuthCryptoCodec,
  user: { id: string; email: string },
): Promise<void> {
  const identifier = pendingIdentifier(codec, user.email);
  await applyScopeSettings(transaction, { ...emptyScopeSettings(), userId: user.id, verificationIdentifier: identifier });
  const pending = await sql<{ value: string }>`SELECT value FROM public.verifications
    WHERE identifier = ${identifier} AND expires_at > ${currentDate()}`.execute(transaction);
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

export type SocialSignUpAgeAnswers = { readonly social: false } | { readonly social: true; readonly answers: PendingSignUpAnswers | null };

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

const emailSignInPaths: ReadonlySet<string> = new Set(["/sign-in/email-otp", "/magic-link/verify"]);

export interface FinishedSignIn {
  readonly path: string;
  readonly user: { readonly id: string; readonly email: string };
  readonly body: unknown;
  readonly oauthState: unknown;
}

export async function refreshSignUpAttestationAfterSignIn(pool: Pool, codec: AuthCryptoCodec, signIn: FinishedSignIn): Promise<void> {
  const social = readSocialSignUpAgeAnswers(signIn.path, signIn.body, signIn.oauthState);
  if (!social.social && !emailSignInPaths.has(signIn.path)) {
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
