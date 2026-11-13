import type { DBAdapter, Where } from "better-auth/adapters";
import type { BetterAuthOptions } from "better-auth/types";
import { sql, type Transaction } from "kysely";
import { extractEmailHmacFromIdentifier, normalizeModelKey, transformVerificationIdentifier } from "./authCodecTransform.js";
import { SESSION_ABSOLUTE_MAX_LIFETIME_SECONDS, SESSION_SLIDING_EXPIRY_SECONDS, SESSION_UPDATE_AGE_SECONDS } from "./authLimits.js";
import type { AuthCryptoCodec } from "./authSecrets.js";
import { currentMs, toDate, toMs } from "../dates.js";

const REVOKE_UNPROVEN_ACCESS_PREFIX = "revoke-unproven-account-access:";
const hashedSessionTokenPattern = /^[0-9a-f]{64}$/u;

export type AuthTransaction = Transaction<Record<string, unknown>>;

export interface AuthScopeSettings {
  userId: string | null;
  verificationIdentifier: string | null;
  verificationId: string | null;
  sessionTokenHash: string | null;
}

export function emptyScopeSettings(): AuthScopeSettings {
  return { userId: null, verificationIdentifier: null, verificationId: null, sessionTokenHash: null };
}

export async function enterAppRole(transaction: AuthTransaction): Promise<void> {
  await sql`SET LOCAL ROLE bjj_app`.execute(transaction);
}

export async function applyScopeSettings(transaction: AuthTransaction, settings: AuthScopeSettings): Promise<void> {
  await sql`SELECT
    set_config('app.user_id', ${settings.userId ?? ""}, true),
    set_config('app.verification_identifier', ${settings.verificationIdentifier ?? ""}, true),
    set_config('app.verification_id', ${settings.verificationId ?? ""}, true),
    set_config('app.session_token_hash', ${settings.sessionTokenHash ?? ""}, true)`.execute(transaction);
}

export async function lookupUserIdByEmailHmacInTransaction(transaction: AuthTransaction, emailHmac: string): Promise<string | null> {
  const result = await sql<{ userId: string | null }>`SELECT public.app_user_id_by_email_hmac(${emailHmac}) AS user_id`.execute(transaction);
  return result.rows[0]?.userId ?? null;
}

async function lookupUserIdByProviderAccountInTransaction(
  transaction: AuthTransaction,
  providerId: string,
  accountId: string,
): Promise<string | null> {
  const result = await sql<{
    userId: string | null;
  }>`SELECT public.app_user_id_by_provider_account(${providerId}, ${accountId}) AS user_id`.execute(transaction);
  return result.rows[0]?.userId ?? null;
}

function readEqualsValue(where: Where[] | undefined, field: string): string | null {
  const clause = where?.find((entry) => entry.field === field && (entry.operator ?? "eq") === "eq");
  return typeof clause?.value === "string" ? clause.value : null;
}

function isHashedSessionToken(value: string): boolean {
  return hashedSessionTokenPattern.test(value);
}

function hashSessionTokenValue(value: string, codec: AuthCryptoCodec): string {
  return isHashedSessionToken(value) ? value : codec.hashSessionToken(value);
}

const NO_USER_ID = "00000000-0000-0000-0000-000000000000";

export interface ResolvedWhereScope {
  readonly clauses: Where[] | undefined;
  readonly rawSessionToken: string | null;
}

export async function resolveWhereScope(
  transaction: AuthTransaction,
  { model, where }: { model: string; where: Where[] | undefined },
  codec: AuthCryptoCodec,
): Promise<ResolvedWhereScope> {
  const modelKey = normalizeModelKey(model);
  const settings = emptyScopeSettings();
  let rawSessionToken: string | null = null;
  const transformed: Where[] = [];

  for (const clause of where ?? []) {
    const { field, value } = clause;
    if (modelKey === "user" && field === "email" && typeof value === "string") {
      const userId = await lookupUserIdByEmailHmacInTransaction(transaction, codec.computeEmailHmac(value));
      settings.userId = userId;
      transformed.push({ ...clause, field: "id", value: userId ?? NO_USER_ID });
      continue;
    }
    if (modelKey === "user" && field === "id" && typeof value === "string") {
      settings.userId = value;
    } else if (
      (modelKey === "session" || modelKey === "account" || modelKey === "verification") &&
      (field === "userId" || field === "user_id") &&
      typeof value === "string"
    ) {
      settings.userId = value;
    } else if (modelKey === "verification" && field === "identifier" && typeof value === "string") {
      const transformedIdentifier = transformVerificationIdentifier(value, codec);
      settings.verificationIdentifier = transformedIdentifier;
      const emailHmac = extractEmailHmacFromIdentifier(value, codec);
      if (emailHmac !== null) {
        settings.userId ??= await lookupUserIdByEmailHmacInTransaction(transaction, emailHmac);
      } else if (transformedIdentifier.startsWith(REVOKE_UNPROVEN_ACCESS_PREFIX)) {
        const suffixUserId = transformedIdentifier.slice(REVOKE_UNPROVEN_ACCESS_PREFIX.length);
        if (suffixUserId.length > 0) {
          settings.userId ??= suffixUserId;
        }
      }
      transformed.push({ ...clause, value: transformedIdentifier });
      continue;
    } else if (modelKey === "verification" && field === "id" && typeof value === "string") {
      settings.verificationId = value;
    } else if (modelKey === "session" && field === "token") {
      if (typeof value === "string") {
        const tokenHash = hashSessionTokenValue(value, codec);
        settings.sessionTokenHash = tokenHash;
        rawSessionToken = isHashedSessionToken(value) ? null : value;
        transformed.push({ ...clause, value: tokenHash });
        continue;
      }
      if (Array.isArray(value)) {
        transformed.push({
          ...clause,
          value: value.map((entry) => (typeof entry === "string" ? hashSessionTokenValue(entry, codec) : entry)) as typeof value,
        });
        continue;
      }
    }
    transformed.push(clause);
  }

  const providerId = readEqualsValue(where, "providerId");
  const accountId = readEqualsValue(where, "accountId");
  if (modelKey === "account" && settings.userId === null && providerId !== null && accountId !== null) {
    settings.userId = await lookupUserIdByProviderAccountInTransaction(transaction, providerId, accountId);
  }

  await applyScopeSettings(transaction, settings);
  if (modelKey === "session" && settings.userId === null && settings.sessionTokenHash !== null) {
    const owner = await sql<{
      userId: string;
    }>`SELECT user_id FROM public.sessions WHERE token = public.app_current_session_token_hash() LIMIT 1`.execute(transaction);
    const ownerUserId = owner.rows[0]?.userId;
    if (ownerUserId !== undefined) {
      settings.userId = ownerUserId;
      await applyScopeSettings(transaction, settings);
    }
  }
  return { clauses: where ? transformed : undefined, rawSessionToken };
}

export function isSessionPastLifetime(row: Record<string, unknown>, nowMs: number): boolean {
  const createdAtMs = toMs(String(row.createdAt));
  const expiresAtMs = toMs(String(row.expiresAt));
  const absoluteMaxMs = createdAtMs + SESSION_ABSOLUTE_MAX_LIFETIME_SECONDS * 1000;
  return nowMs >= expiresAtMs || nowMs >= absoluteMaxMs;
}

export function capSessionCreateExpiry(encoded: Record<string, unknown>): void {
  const createdAtMs = encoded.createdAt instanceof Date ? toMs(encoded.createdAt) : currentMs();
  const requestedExpiresAtMs = encoded.expiresAt instanceof Date ? toMs(encoded.expiresAt) : createdAtMs + SESSION_SLIDING_EXPIRY_SECONDS * 1000;
  const absoluteCapMs = createdAtMs + SESSION_ABSOLUTE_MAX_LIFETIME_SECONDS * 1000;
  encoded.expiresAt = toDate(Math.min(requestedExpiresAtMs, absoluteCapMs));
}

export async function applySessionUpdateRules(
  scoped: DBAdapter<BetterAuthOptions>,
  updateContext: {
    model: string;
    clauses: Where[];
    encodedUpdate: Record<string, unknown>;
  },
): Promise<Record<string, unknown> | null> {
  const { model, clauses, encodedUpdate } = updateContext;
  const existing = await scoped.findOne<Record<string, unknown>>({ model, where: clauses });
  if (!existing) {
    return null;
  }
  const nowMs = currentMs();
  const createdAtMs = toMs(String(existing.createdAt));
  const absoluteCapMs = createdAtMs + SESSION_ABSOLUTE_MAX_LIFETIME_SECONDS * 1000;
  if (nowMs >= absoluteCapMs) {
    await scoped.delete({
      model,
      where: [{ field: "id", operator: "eq", value: String(existing.id), connector: "AND" }],
    });
    return null;
  }
  const updatedAtMs = toMs(String(existing.updatedAt));
  if (nowMs - updatedAtMs < SESSION_UPDATE_AGE_SECONDS * 1000) {
    return existing;
  }
  const requestedExpiresAtMs =
    encodedUpdate.expiresAt instanceof Date ? toMs(encodedUpdate.expiresAt) : nowMs + SESSION_SLIDING_EXPIRY_SECONDS * 1000;
  encodedUpdate.expiresAt = toDate(Math.min(requestedExpiresAtMs, absoluteCapMs));
  encodedUpdate.updatedAt = toDate(nowMs);
  return await scoped.update<Record<string, unknown>>({
    model,
    where: clauses,
    update: encodedUpdate,
  });
}
