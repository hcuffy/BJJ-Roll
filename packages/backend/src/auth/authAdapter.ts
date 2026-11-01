import { kyselyAdapter } from "@better-auth/kysely-adapter";
import type { DBAdapter, Where } from "better-auth/adapters";
import type { BetterAuthOptions } from "better-auth/types";
import { CamelCasePlugin, Kysely, PostgresDialect } from "kysely";
import type { Pool } from "pg";
import { decodeDatabaseRow, encodeCreateData, encodeRateLimitWhere, encodeUpdateData, normalizeModelKey } from "./authCodecTransform.js";
import type { AuthCryptoCodec } from "./authSecrets.js";
import {
  applyScopeSettings,
  applySessionUpdateRules,
  capSessionCreateExpiry,
  emptyScopeSettings,
  enterAppRole,
  isSessionPastLifetime,
  lookupUserIdByEmailHmacInTransaction,
  resolveWhereScope,
  type AuthTransaction,
  type ResolvedWhereScope,
} from "./authSessionScope.js";
import { currentMs } from "../dates.js";

export interface CreateEncryptedRlsAuthAdapterOptions {
  readonly pool: Pool;
  readonly codec: AuthCryptoCodec;
  readonly onUserCreated?: (transaction: AuthTransaction, user: { id: string; email: string }) => Promise<void>;
}

type RunInTransaction = <TResult>(work: (transaction: AuthTransaction) => Promise<TResult>) => Promise<TResult>;
type RowRecord = Record<string, unknown>;

function serializeOnTransaction(transaction: AuthTransaction): RunInTransaction {
  let tail: Promise<unknown> = Promise.resolve();
  return <TResult>(work: (transactionDb: AuthTransaction) => Promise<TResult>): Promise<TResult> => {
    const next = tail.then(() => work(transaction));
    tail = next.catch(() => undefined);
    return next;
  };
}

export function createEncryptedRlsAuthAdapter(
  adapterContext: CreateEncryptedRlsAuthAdapterOptions,
): (options: BetterAuthOptions) => DBAdapter<BetterAuthOptions> {
  const { pool, codec, onUserCreated } = adapterContext;
  const kyselyDb = new Kysely<RowRecord>({
    dialect: new PostgresDialect({ pool }),
    plugins: [new CamelCasePlugin()],
  });

  const runInNewTransaction: RunInTransaction = (work) =>
    kyselyDb.transaction().execute(async (transaction) => {
      await enterAppRole(transaction);
      return await work(transaction);
    });

  return (options: BetterAuthOptions): DBAdapter<BetterAuthOptions> => {
    const baseAdapter = kyselyAdapter(kyselyDb, { type: "postgres" })(options);
    const decodeRow = (model: string, row: RowRecord | null, rawSessionToken: string | null): RowRecord | null => {
      const decoded = decodeDatabaseRow(model, row, codec);
      if (decoded && rawSessionToken !== null && normalizeModelKey(model) === "session") {
        return { ...decoded, token: rawSessionToken };
      }
      return decoded;
    };

    const buildAdapter = (run: RunInTransaction, sharedTransaction: AuthTransaction | null): DBAdapter<BetterAuthOptions> => {
      const scoped = <TResult>(
        { model, where }: { model: string; where: Where[] | undefined },
        operation: (adapter: DBAdapter<BetterAuthOptions>, scope: ResolvedWhereScope) => Promise<TResult>,
      ): Promise<TResult> =>
        run(async (transaction) => {
          const scope = await resolveWhereScope(transaction, { model, where: encodeRateLimitWhere(model, where, codec) }, codec);
          return await operation(kyselyAdapter(transaction, { type: "postgres" })(options), scope);
        });

      const adapterInstance: DBAdapter<BetterAuthOptions> = {
        id: "bjj-encrypted-rls-kysely",
        options: baseAdapter.options,
        createSchema: baseAdapter.createSchema,
        async transaction(callback) {
          if (sharedTransaction !== null) {
            return await callback(adapterInstance);
          }
          return await kyselyDb.transaction().execute(async (transaction) => {
            await enterAppRole(transaction);
            return await callback(buildAdapter(serializeOnTransaction(transaction), transaction));
          });
        },
        async create({ model, data }) {
          const modelKey = normalizeModelKey(model);
          const { encoded, emailHmac } = encodeCreateData(model, data, codec);
          let rawSessionToken: string | null = null;
          if (modelKey === "session") {
            capSessionCreateExpiry(encoded);
            if (typeof encoded.token === "string") {
              rawSessionToken = encoded.token;
              encoded.token = codec.hashSessionToken(rawSessionToken);
            }
          }
          return (await run(async (transaction) => {
            const settings = emptyScopeSettings();
            if (modelKey === "user") {
              settings.userId = String(encoded.id);
            } else if (modelKey === "session" || modelKey === "account") {
              settings.userId = typeof encoded.userId === "string" ? encoded.userId : null;
            } else if (modelKey === "verification") {
              settings.verificationIdentifier = typeof encoded.identifier === "string" ? encoded.identifier : null;
              if (emailHmac !== null) {
                const userId = await lookupUserIdByEmailHmacInTransaction(transaction, emailHmac);
                encoded.userId = userId;
                settings.userId = userId;
              } else if (typeof encoded.userId === "string") {
                settings.userId = encoded.userId;
              }
            }
            await applyScopeSettings(transaction, settings);
            const created = await kyselyAdapter(transaction, { type: "postgres" })(options).create<RowRecord, RowRecord>({
              model,
              data: encoded,
              forceAllowId: true,
            });
            if (modelKey === "user" && onUserCreated) {
              await onUserCreated(transaction, { id: String(encoded.id), email: String(data.email) });
            }
            return decodeRow(model, created, rawSessionToken);
          })) as never;
        },
        async findOne({ model, where, join }) {
          const modelKey = normalizeModelKey(model);
          return (await scoped<RowRecord | null>({ model, where }, async (adapter, scope) => {
            const row = await adapter.findOne<RowRecord>({ model, where: scope.clauses ?? [], join });
            if (row && modelKey === "session" && isSessionPastLifetime(row, currentMs())) {
              await adapter.delete({ model, where: [{ field: "id", operator: "eq", value: String(row.id), connector: "AND" }] });
              return null;
            }
            return decodeRow(model, row, scope.rawSessionToken);
          })) as never;
        },
        async findMany({ model, where, limit, sortBy, offset, join }) {
          const modelKey = normalizeModelKey(model);
          return (await scoped<RowRecord[]>({ model, where }, async (adapter, scope) => {
            const rows = await adapter.findMany<RowRecord>({ model, where: scope.clauses, limit, sortBy, offset, join });
            const nowMs = currentMs();
            const live = modelKey === "session" ? rows.filter((row) => !isSessionPastLifetime(row, nowMs)) : rows;
            return live.map((row) => decodeRow(model, row, scope.rawSessionToken) as RowRecord);
          })) as never;
        },
        async update({ model, where, update }) {
          const modelKey = normalizeModelKey(model);
          const encodedUpdate = encodeUpdateData(model, update as RowRecord, codec);
          return (await scoped<RowRecord | null>({ model, where }, async (adapter, scope) => {
            const clauses = scope.clauses ?? [];
            const updated =
              modelKey === "session"
                ? await applySessionUpdateRules(adapter, { model, clauses, encodedUpdate })
                : await adapter.update<RowRecord>({ model, where: clauses, update: encodedUpdate });
            return decodeRow(model, updated, scope.rawSessionToken);
          })) as never;
        },
        async updateMany({ model, where, update }) {
          const encodedUpdate = encodeUpdateData(model, update, codec);
          return await scoped({ model, where }, (adapter, scope) => adapter.updateMany({ model, where: scope.clauses ?? [], update: encodedUpdate }));
        },
        async delete({ model, where }) {
          await scoped({ model, where }, (adapter, scope) => adapter.delete({ model, where: scope.clauses ?? [] }));
        },
        async deleteMany({ model, where }) {
          return await scoped({ model, where }, (adapter, scope) => adapter.deleteMany({ model, where: scope.clauses ?? [] }));
        },
        async count({ model, where }) {
          return await scoped({ model, where }, (adapter, scope) => adapter.count({ model, where: scope.clauses }));
        },
        async consumeOne({ model, where }) {
          return (await scoped<RowRecord | null>({ model, where }, async (adapter, scope) => {
            const consumed = await adapter.consumeOne<RowRecord>({ model, where: scope.clauses ?? [] });
            return decodeRow(model, consumed, scope.rawSessionToken);
          })) as never;
        },
        async incrementOne({ model, where, increment, set }) {
          return (await scoped<RowRecord | null>({ model, where }, async (adapter, scope) => {
            const incremented = await adapter.incrementOne<RowRecord>({ model, where: scope.clauses ?? [], increment, set });
            return decodeRow(model, incremented, scope.rawSessionToken);
          })) as never;
        },
      };
      return adapterInstance;
    };

    return buildAdapter(runInNewTransaction, null);
  };
}
