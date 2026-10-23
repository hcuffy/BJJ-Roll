import { kyselyAdapter } from "@better-auth/kysely-adapter";
import type { DBAdapter, Where } from "better-auth/adapters";
import type { BetterAuthOptions } from "better-auth/types";
import { CamelCasePlugin, Kysely, PostgresDialect } from "kysely";
import type { Pool } from "pg";
import { lookupUserIdByEmailHmacFromPool } from "../database/index.js";
import { decodeDatabaseRow, encodeCreateData, encodeUpdateData, normalizeModelKey } from "./authCodecTransform.js";
import type { AuthCryptoCodec } from "./authSecrets.js";
import {
  applySessionUpdateRules,
  capSessionCreateExpiry,
  isSessionPastLifetime,
  prepareWhereScope,
  runWithScopedAdapter,
} from "./authSessionScope.js";

export interface CreateEncryptedRlsAuthAdapterOptions {
  readonly pool: Pool;
  readonly codec: AuthCryptoCodec;
}

export function createEncryptedRlsAuthAdapter(
  adapterContext: CreateEncryptedRlsAuthAdapterOptions,
): (options: BetterAuthOptions) => DBAdapter<BetterAuthOptions> {
  const { pool, codec } = adapterContext;
  const kyselyDb = new Kysely<Record<string, unknown>>({
    dialect: new PostgresDialect({ pool }),
    plugins: [new CamelCasePlugin()],
  });
  const resolveScope = (model: string, where: Where[] | undefined) => prepareWhereScope(model, where, { pool, codec });

  return (options: BetterAuthOptions): DBAdapter<BetterAuthOptions> => {
    const baseAdapter = kyselyAdapter(kyselyDb, { type: "postgres" })(options);
    const adapterInstance: DBAdapter<BetterAuthOptions> = {
      id: "bjj-encrypted-rls-kysely",
      options: baseAdapter.options,
      createSchema: baseAdapter.createSchema,
      async transaction(callback) {
        return await callback(adapterInstance);
      },
      async create({ model, data }) {
        const modelKey = normalizeModelKey(model);
        const { encoded, emailHmac } = encodeCreateData(model, data, codec);
        let userId: string | null = null;
        let useAppRole = false;
        if (modelKey === "user") {
          userId = String(encoded.id);
          useAppRole = true;
        } else if (modelKey === "session" || modelKey === "account") {
          userId = typeof encoded.userId === "string" ? encoded.userId : null;
          useAppRole = userId !== null;
          if (modelKey === "session") {
            capSessionCreateExpiry(encoded);
          }
        } else if (modelKey === "verification" && emailHmac !== null) {
          userId = await lookupUserIdByEmailHmacFromPool(pool, emailHmac);
          if (userId !== null) {
            encoded.userId = userId;
            useAppRole = true;
          }
        } else if (modelKey === "rateLimit") {
          useAppRole = true;
        }
        const created = await runWithScopedAdapter<Record<string, unknown>>(kyselyDb, options, {
          userId,
          useAppRole,
          operation: (scoped) => scoped.create({ model, data: encoded, forceAllowId: true }),
        });
        return decodeDatabaseRow(model, created, codec) as never;
      },
      async findOne({ model, where, join }) {
        const { modelKey, encodedWhere, userId, useAppRole } = await resolveScope(model, where);
        if (encodedWhere.unmatchedEmailLookup || ((modelKey === "user" || modelKey === "session") && userId === null)) {
          return null;
        }
        const found = await runWithScopedAdapter<Record<string, unknown> | null>(kyselyDb, options, {
          userId,
          useAppRole,
          operation: async (scoped) => {
            const row = await scoped.findOne<Record<string, unknown>>({
              model,
              where: encodedWhere.clauses ?? [],
              join,
            });
            if (!row || modelKey !== "session") {
              return row;
            }
            if (isSessionPastLifetime(row, Date.now())) {
              await scoped.delete({
                model,
                where: [{ field: "id", operator: "eq", value: String(row.id), connector: "AND" }],
              });
              return null;
            }
            return row;
          },
        });
        return decodeDatabaseRow(model, found, codec) as never;
      },
      async findMany({ model, where, limit, sortBy, offset, join }) {
        const { modelKey, encodedWhere, userId, useAppRole } = await resolveScope(model, where);
        if (encodedWhere.unmatchedEmailLookup || ((modelKey === "user" || modelKey === "session") && userId === null && (where?.length ?? 0) > 0)) {
          return [];
        }
        const rows = await runWithScopedAdapter<Record<string, unknown>[]>(kyselyDb, options, {
          userId,
          useAppRole,
          operation: (scoped) => scoped.findMany({ model, where: encodedWhere.clauses, limit, sortBy, offset, join }),
        });
        const nowMs = Date.now();
        const filtered = modelKey === "session" ? rows.filter((row) => !isSessionPastLifetime(row, nowMs)) : rows;
        return filtered.map((row) => decodeDatabaseRow(model, row, codec)) as never;
      },
      async update({ model, where, update }) {
        const { modelKey, encodedWhere, userId, useAppRole } = await resolveScope(model, where);
        if (encodedWhere.unmatchedEmailLookup || ((modelKey === "user" || modelKey === "session") && userId === null)) {
          return null;
        }
        const encodedUpdate = encodeUpdateData(model, update as Record<string, unknown>, codec);
        const updated = await runWithScopedAdapter<Record<string, unknown> | null>(kyselyDb, options, {
          userId,
          useAppRole,
          operation: async (scoped) => {
            const clauses = encodedWhere.clauses ?? [];
            if (modelKey === "session") {
              return await applySessionUpdateRules(scoped, { model, clauses, encodedUpdate });
            }
            return await scoped.update<Record<string, unknown>>({
              model,
              where: clauses,
              update: encodedUpdate,
            });
          },
        });
        return decodeDatabaseRow(model, updated, codec) as never;
      },
      async updateMany({ model, where, update }) {
        const { encodedWhere, userId, useAppRole } = await resolveScope(model, where);
        if (encodedWhere.unmatchedEmailLookup) {
          return 0;
        }
        const encodedUpdate = encodeUpdateData(model, update, codec);
        return await runWithScopedAdapter(kyselyDb, options, {
          userId,
          useAppRole,
          operation: (scoped) => scoped.updateMany({ model, where: encodedWhere.clauses ?? [], update: encodedUpdate }),
        });
      },
      async delete({ model, where }) {
        const { encodedWhere, userId, useAppRole } = await resolveScope(model, where);
        if (encodedWhere.unmatchedEmailLookup) {
          return;
        }
        await runWithScopedAdapter(kyselyDb, options, {
          userId,
          useAppRole,
          operation: (scoped) => scoped.delete({ model, where: encodedWhere.clauses ?? [] }),
        });
      },
      async deleteMany({ model, where }) {
        const { encodedWhere, userId, useAppRole } = await resolveScope(model, where);
        if (encodedWhere.unmatchedEmailLookup) {
          return 0;
        }
        return await runWithScopedAdapter(kyselyDb, options, {
          userId,
          useAppRole,
          operation: (scoped) => scoped.deleteMany({ model, where: encodedWhere.clauses ?? [] }),
        });
      },
      async count({ model, where }) {
        const { encodedWhere, userId, useAppRole } = await resolveScope(model, where);
        if (encodedWhere.unmatchedEmailLookup) {
          return 0;
        }
        return await runWithScopedAdapter(kyselyDb, options, {
          userId,
          useAppRole,
          operation: (scoped) => scoped.count({ model, where: encodedWhere.clauses }),
        });
      },
      async consumeOne({ model, where }) {
        const { encodedWhere, userId, useAppRole } = await resolveScope(model, where);
        if (encodedWhere.unmatchedEmailLookup) {
          return null;
        }
        const consumed = await runWithScopedAdapter<Record<string, unknown> | null>(kyselyDb, options, {
          userId,
          useAppRole,
          operation: (scoped) => scoped.consumeOne({ model, where: encodedWhere.clauses ?? [] }),
        });
        return decodeDatabaseRow(model, consumed, codec) as never;
      },
      async incrementOne({ model, where, increment, set }) {
        const { encodedWhere, userId, useAppRole } = await resolveScope(model, where);
        if (encodedWhere.unmatchedEmailLookup) {
          return null;
        }
        const incremented = await runWithScopedAdapter<Record<string, unknown> | null>(kyselyDb, options, {
          userId,
          useAppRole,
          operation: (scoped) => scoped.incrementOne({ model, where: encodedWhere.clauses ?? [], increment, set }),
        });
        return decodeDatabaseRow(model, incremented, codec) as never;
      },
    };
    return adapterInstance;
  };
}
