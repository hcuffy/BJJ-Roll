import { randomUUID } from "node:crypto";
import { AGE_CONFIRMATION_TEXT_VERSION_ID, AGE_GATE_REFUSAL_MESSAGE, age16ConfirmedSchema } from "@bjj-roll/shared";
import { APIError } from "better-auth/api";
import type { Pool, PoolClient } from "pg";
import { MAGIC_LINK_EXPIRY_SECONDS, OTP_EXPIRY_SECONDS } from "./authLimits.js";
import type { AuthCryptoCodec } from "./authSecrets.js";

/**
 * HEN-263 (replaces the HEN-77 send-time refusal): every sign-in send gets the same answer, so a send never tells whether an
 * email has an account. The age answers ride along as a pending verification row keyed by the email HMAC, and the check runs
 * where the account is created: when the code is used or the link is opened. A refusal happens on those verify paths, so it
 * never adds to the per-IP or per-email send counters; guessing there stays under the documented verify limit (20 / IP / 15 min).
 */
const PENDING_IDENTIFIER_PREFIX = "age-confirmation-";
const PENDING_EXPIRY_SECONDS = Math.max(OTP_EXPIRY_SECONDS, MAGIC_LINK_EXPIRY_SECONDS);

export interface PendingAgeAnswers {
  readonly age16Confirmed: true;
  readonly age18Confirmed: boolean;
}

function parsePendingAgeAnswers(value: unknown): PendingAgeAnswers | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  return record.age16Confirmed === true && typeof record.age18Confirmed === "boolean"
    ? { age16Confirmed: true, age18Confirmed: record.age18Confirmed }
    : null;
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
 * Same work for every email: drop any earlier pending answer, then store this send's answer when the 16+ box was ticked.
 * The latest send wins, so an unticked resend withdraws an earlier tick. Known emails get the row too (linked to the user
 * so it goes with the account); it is never read for them and expires with the code.
 */
export async function recordPendingAgeAnswers(pool: Pool, codec: AuthCryptoCodec, body: Record<string, unknown> & { email: string }): Promise<void> {
  const identifier = pendingIdentifier(codec, body.email);
  const age16Confirmed = age16ConfirmedSchema.safeParse(body.age16Confirmed).success;
  const answers: PendingAgeAnswers = { age16Confirmed: true, age18Confirmed: body.age18Confirmed === true };
  await withAppRole(pool, { verificationIdentifier: identifier }, async (client) => {
    await client.query("DELETE FROM public.verifications WHERE identifier = $1", [identifier]);
    if (!age16Confirmed) {
      return;
    }
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

async function selectPendingAgeAnswers(client: PoolClient, codec: AuthCryptoCodec, identifier: string): Promise<PendingAgeAnswers | null> {
  const result = await client.query<{ value: string }>("SELECT value FROM public.verifications WHERE identifier = $1 AND expires_at > $2", [
    identifier,
    new Date(), // the app clock, like Better Auth's own expiry checks
  ]);
  const value = result.rows[0]?.value;
  if (value === undefined) {
    return null;
  }
  return parsePendingAgeAnswers(JSON.parse(codec.decryptVerificationPayload(value)));
}

/** Before the user row is written: refuse unless this email's latest send carried the 16+ tick. */
export async function assertPendingAgeConfirmation(pool: Pool, codec: AuthCryptoCodec, email: string): Promise<void> {
  const identifier = pendingIdentifier(codec, email);
  const answers = await withAppRole(pool, { verificationIdentifier: identifier }, (client) => selectPendingAgeAnswers(client, codec, identifier));
  if (!answers) {
    throw ageConfirmationRequiredError();
  }
}

/** After the user row is committed: move the pending answers onto the user's age_confirmation consent record. */
export async function storeAgeConfirmationForNewUser(pool: Pool, codec: AuthCryptoCodec, user: { id: string; email: string }): Promise<void> {
  const identifier = pendingIdentifier(codec, user.email);
  await withAppRole(pool, { verificationIdentifier: identifier, userId: user.id }, async (client) => {
    const answers = await selectPendingAgeAnswers(client, codec, identifier);
    await client.query("DELETE FROM public.verifications WHERE identifier = $1", [identifier]);
    if (!answers) {
      throw ageConfirmationRequiredError();
    }
    await client.query(
      `INSERT INTO public.consent_records (id, user_id, consent_type, text_version_id, age16_confirmed, age18_confirmed)
       VALUES ($1, $2, 'age_confirmation', $3, $4, $5)`,
      [randomUUID(), user.id, AGE_CONFIRMATION_TEXT_VERSION_ID, answers.age16Confirmed, answers.age18Confirmed],
    );
  });
}
