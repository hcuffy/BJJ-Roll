import { kyselyAdapter } from "@better-auth/kysely-adapter";
import type { DBAdapter, Where } from "better-auth/adapters";
import type { BetterAuthOptions } from "better-auth/types";
import { sql, type Kysely } from "kysely";
import type { Pool } from "pg";
import { lookupUserIdByEmailHmacFromPool } from "../database/index.js";
import { extractEmailHmacFromIdentifier, normalizeModelKey, transformVerificationIdentifier } from "./authCodecTransform.js";
import { SESSION_ABSOLUTE_MAX_LIFETIME_SECONDS, SESSION_SLIDING_EXPIRY_SECONDS, SESSION_UPDATE_AGE_SECONDS } from "./authLimits.js";
import type { AuthCryptoCodec } from "./authSecrets.js";

const REVOKE_UNPROVEN_ACCESS_PREFIX = "revoke-unproven-account-access:";

export async function runWithScopedAdapter<TResult>(
  kyselyDb: Kysely<Record<string, unknown>>,
  options: BetterAuthOptions,
  scope: {
    userId: string | null;
    useAppRole: boolean;
    operation: (adapter: DBAdapter<BetterAuthOptions>) => Promise<TResult>;
  },
): Promise<TResult> {
  return await kyselyDb.transaction().execute(async (transactionDb) => {
    if (scope.useAppRole) {
      await sql`SET LOCAL ROLE bjj_app`.execute(transactionDb);
      await sql`SELECT set_config('app.user_id', ${scope.userId ?? ""}, true)`.execute(transactionDb);
    }
    const scopedAdapter = kyselyAdapter(transactionDb, { type: "postgres" })(options);
    return await scope.operation(scopedAdapter);
  });
}

export function isSessionPastLifetime(row: Record<string, unknown>, nowMs: number): boolean {
  const createdAtMs = new Date(String(row.createdAt)).getTime();
  const expiresAtMs = new Date(String(row.expiresAt)).getTime();
  const absoluteMaxMs = createdAtMs + SESSION_ABSOLUTE_MAX_LIFETIME_SECONDS * 1000;
  return nowMs >= expiresAtMs || nowMs >= absoluteMaxMs;
}

export function capSessionCreateExpiry(encoded: Record<string, unknown>): void {
  const createdAtMs = encoded.createdAt instanceof Date ? encoded.createdAt.getTime() : Date.now();
  const requestedExpiresAtMs = encoded.expiresAt instanceof Date ? encoded.expiresAt.getTime() : createdAtMs + SESSION_SLIDING_EXPIRY_SECONDS * 1000;
  const absoluteCapMs = createdAtMs + SESSION_ABSOLUTE_MAX_LIFETIME_SECONDS * 1000;
  encoded.expiresAt = new Date(Math.min(requestedExpiresAtMs, absoluteCapMs));
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
  const nowMs = Date.now();
  const createdAtMs = new Date(String(existing.createdAt)).getTime();
  const absoluteCapMs = createdAtMs + SESSION_ABSOLUTE_MAX_LIFETIME_SECONDS * 1000;
  if (nowMs >= absoluteCapMs) {
    await scoped.delete({
      model,
      where: [{ field: "id", operator: "eq", value: String(existing.id), connector: "AND" }],
    });
    return null;
  }
  const updatedAtMs = new Date(String(existing.updatedAt)).getTime();
  if (nowMs - updatedAtMs < SESSION_UPDATE_AGE_SECONDS * 1000) {
    return existing;
  }
  const requestedExpiresAtMs =
    encodedUpdate.expiresAt instanceof Date ? encodedUpdate.expiresAt.getTime() : nowMs + SESSION_SLIDING_EXPIRY_SECONDS * 1000;
  encodedUpdate.expiresAt = new Date(Math.min(requestedExpiresAtMs, absoluteCapMs));
  encodedUpdate.updatedAt = new Date(nowMs);
  return await scoped.update<Record<string, unknown>>({
    model,
    where: clauses,
    update: encodedUpdate,
  });
}

export async function encodeWhereClauses(
  model: string,
  clauses: Where[] | undefined,
  dependencies: { pool: Pool; codec: AuthCryptoCodec },
): Promise<{
  clauses: Where[] | undefined;
  resolvedUserId: string | null;
  unmatchedEmailLookup: boolean;
}> {
  if (!clauses || clauses.length === 0) {
    return { clauses, resolvedUserId: null, unmatchedEmailLookup: false };
  }
  const { pool, codec } = dependencies;
  const modelKey = normalizeModelKey(model);
  const transformed: Where[] = [];
  let resolvedUserId: string | null = null;

  for (const clause of clauses) {
    if (modelKey === "user" && clause.field === "email" && typeof clause.value === "string") {
      const lookedUpUserId = await lookupUserIdByEmailHmacFromPool(pool, codec.computeEmailHmac(clause.value));
      if (lookedUpUserId === null) {
        return { clauses: [], resolvedUserId: null, unmatchedEmailLookup: true };
      }
      resolvedUserId = lookedUpUserId;
      transformed.push({ ...clause, field: "id", value: lookedUpUserId });
      continue;
    }
    if (modelKey === "user" && clause.field === "id" && typeof clause.value === "string") {
      resolvedUserId = clause.value;
    } else if (
      (modelKey === "session" || modelKey === "account" || modelKey === "verification") &&
      (clause.field === "userId" || clause.field === "user_id") &&
      typeof clause.value === "string"
    ) {
      resolvedUserId = clause.value;
    } else if (modelKey === "account" && clause.field === "id" && typeof clause.value === "string" && resolvedUserId === null) {
      const lookedUp = await pool.query<{ user_id: string }>("SELECT user_id FROM public.accounts WHERE id = $1 LIMIT 1", [clause.value]);
      resolvedUserId = lookedUp.rows[0]?.user_id ?? null;
    } else if (modelKey === "verification" && clause.field === "identifier" && typeof clause.value === "string") {
      const transformedIdentifier = transformVerificationIdentifier(clause.value, codec);
      const emailHmac = extractEmailHmacFromIdentifier(clause.value, codec);
      if (emailHmac !== null) {
        resolvedUserId = await lookupUserIdByEmailHmacFromPool(pool, emailHmac);
      } else if (transformedIdentifier.startsWith(REVOKE_UNPROVEN_ACCESS_PREFIX)) {
        const suffixUserId = transformedIdentifier.slice(REVOKE_UNPROVEN_ACCESS_PREFIX.length);
        if (suffixUserId.length > 0) {
          resolvedUserId = suffixUserId;
        }
      } else {
        const lookedUp = await pool.query<{ user_id: string | null }>(
          "SELECT user_id FROM public.verifications WHERE identifier = $1 ORDER BY created_at DESC LIMIT 1",
          [transformedIdentifier],
        );
        resolvedUserId = lookedUp.rows[0]?.user_id ?? null;
      }
      transformed.push({ ...clause, value: transformedIdentifier });
      continue;
    } else if (modelKey === "verification" && clause.field === "id" && typeof clause.value === "string" && resolvedUserId === null) {
      const lookedUp = await pool.query<{ user_id: string | null }>("SELECT user_id FROM public.verifications WHERE id = $1 LIMIT 1", [clause.value]);
      resolvedUserId = lookedUp.rows[0]?.user_id ?? null;
    }
    transformed.push(clause);
  }
  return { clauses: transformed, resolvedUserId, unmatchedEmailLookup: false };
}

export async function prepareWhereScope(model: string, where: Where[] | undefined, dependencies: { pool: Pool; codec: AuthCryptoCodec }) {
  const modelKey = normalizeModelKey(model);
  const encodedWhere = await encodeWhereClauses(model, where, dependencies);
  let userId = encodedWhere.resolvedUserId;
  if (modelKey === "session" && userId === null && encodedWhere.clauses) {
    for (const clause of encodedWhere.clauses) {
      if ((clause.field === "token" || clause.field === "id") && typeof clause.value === "string") {
        const column = clause.field === "token" ? "token" : "id";
        const lookedUp = await dependencies.pool.query<{ user_id: string }>(`SELECT user_id FROM public.sessions WHERE ${column} = $1 LIMIT 1`, [
          clause.value,
        ]);
        userId = lookedUp.rows[0]?.user_id ?? null;
        break;
      }
    }
  }
  const useAppRole = userId !== null || modelKey === "rateLimit";
  return { modelKey, encodedWhere, userId, useAppRole };
}
