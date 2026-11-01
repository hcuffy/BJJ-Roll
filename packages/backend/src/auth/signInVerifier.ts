import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { MAGIC_LINK_EXPIRY_SECONDS } from "./authLimits.js";
import type { AuthCryptoCodec } from "./authSecrets.js";
import { currentDate, currentMs, secondsAfter, toMs } from "../dates.js";
import { withPoolTransaction } from "../database/connection.js";

const VERIFIER_IDENTIFIER_PREFIX = "magic-link-verifier:";
const verifierHashPattern = /^[0-9a-f]{64}$/u;

export function withVerificationScope<Result>(
  pool: Pool,
  scope: { readonly identifier: string; readonly userId?: string },
  operation: (client: PoolClient) => Promise<Result>,
): Promise<Result> {
  return withPoolTransaction(pool, async (client) => {
    await client.query("SET LOCAL ROLE bjj_app");
    await client.query("SELECT set_config('app.user_id', $1, true), set_config('app.verification_identifier', $2, true)", [
      scope.userId ?? "",
      scope.identifier,
    ]);
    const result = await operation(client);
    return result;
  });
}

export interface VerificationInsert {
  readonly identifier: string;
  readonly userId: string | null;
  readonly value: string;
  readonly lifetimeSeconds: number;
  readonly emailHash?: string;
}

export async function insertVerification(client: PoolClient, row: VerificationInsert): Promise<void> {
  const now = currentDate();
  await client.query(
    `INSERT INTO public.verifications (id, user_id, identifier, value, email_hash, expires_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [randomUUID(), row.userId, row.identifier, row.value, row.emailHash ?? null, secondsAfter(now, row.lifetimeSeconds), now, now],
  );
}

export function readVerifierHash(source: unknown): string | null {
  const candidate = typeof source === "object" && source !== null ? (source as Record<string, unknown>).verifierHash : undefined;
  return typeof candidate === "string" && verifierHashPattern.test(candidate) ? candidate : null;
}

function magicLinkVerifierIdentifier(codec: AuthCryptoCodec, magicLinkToken: string): string {
  return `${VERIFIER_IDENTIFIER_PREFIX}${codec.hashMagicLinkToken(magicLinkToken)}`;
}

export async function storeMagicLinkVerifier(
  pool: Pool,
  codec: AuthCryptoCodec,
  magicLink: { readonly email: string; readonly token: string; readonly metadata: unknown },
): Promise<void> {
  const verifierHash = readVerifierHash(magicLink.metadata);
  if (verifierHash === null) {
    return;
  }
  const identifier = magicLinkVerifierIdentifier(codec, magicLink.token);
  await withVerificationScope(pool, { identifier }, async (client) => {
    await insertVerification(client, {
      identifier,
      userId: null,
      value: codec.encryptVerificationPayload(JSON.stringify({ verifierHash })),
      lifetimeSeconds: MAGIC_LINK_EXPIRY_SECONDS,
      emailHash: codec.computeEmailHmac(magicLink.email),
    });
  });
}

export async function takeMagicLinkVerifierHash(pool: Pool, codec: AuthCryptoCodec, magicLinkToken: unknown): Promise<string | null> {
  if (typeof magicLinkToken !== "string" || magicLinkToken === "") {
    return null;
  }
  const identifier = magicLinkVerifierIdentifier(codec, magicLinkToken);
  const deleted = await withVerificationScope(pool, { identifier }, (client) =>
    client.query<{ value: string; expires_at: Date | string }>("DELETE FROM public.verifications WHERE identifier = $1 RETURNING value, expires_at", [
      identifier,
    ]),
  );
  const row = deleted.rows[0];
  if (!row || currentMs() >= toMs(row.expires_at)) {
    return null;
  }
  return readVerifierHash(JSON.parse(codec.decryptVerificationPayload(row.value)));
}

export function verifierMatches(storedVerifierHash: string | null, verifier: unknown): boolean {
  if (storedVerifierHash === null || typeof verifier !== "string" || verifier === "") {
    return false;
  }
  return timingSafeEqual(createHash("sha256").update(verifier).digest(), Buffer.from(storedVerifierHash, "hex"));
}
