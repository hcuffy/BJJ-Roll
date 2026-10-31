import { CamelCasePlugin, Kysely, PostgresDialect, sql, type Transaction } from "kysely";
import type { Pool } from "pg";
import type { BjjRollDatabase } from "./schema.js";

export function createDatabase(pool: Pool): Kysely<BjjRollDatabase> {
  return new Kysely<BjjRollDatabase>({
    dialect: new PostgresDialect({ pool }),
    plugins: [new CamelCasePlugin()],
  });
}

export function withUserContext<Result>(
  db: Kysely<BjjRollDatabase>,
  userId: string,
  operation: (transaction: Transaction<BjjRollDatabase>) => Promise<Result>,
): Promise<Result> {
  return db.transaction().execute(async (transaction) => {
    await sql`SET LOCAL ROLE bjj_app`.execute(transaction);
    await sql`SELECT set_config('app.user_id', ${userId}, true)`.execute(transaction);
    return await operation(transaction);
  });
}

export function withAppRoleUnscoped<Result>(
  db: Kysely<BjjRollDatabase>,
  operation: (transaction: Transaction<BjjRollDatabase>) => Promise<Result>,
): Promise<Result> {
  return db.transaction().execute(async (transaction) => {
    await sql`SET LOCAL ROLE bjj_app`.execute(transaction);
    await sql`RESET app.user_id`.execute(transaction);
    return await operation(transaction);
  });
}

export function lookupUserIdByEmailHmac(db: Kysely<BjjRollDatabase>, emailHmac: string): Promise<string | null> {
  return withAppRoleUnscoped(db, async (transaction) => {
    const queryResult = await sql<{ userId: string | null }>`
      SELECT public.app_user_id_by_email_hmac(${emailHmac}) AS user_id
    `.execute(transaction);
    return queryResult.rows[0]?.userId ?? null;
  });
}

export async function lookupUserIdByEmailHmacFromPool(pool: Pool, emailHmac: string): Promise<string | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE bjj_app");
    await client.query("RESET app.user_id");
    const result = await client.query<{ user_id: string | null }>("SELECT public.app_user_id_by_email_hmac($1) AS user_id", [emailHmac]);
    await client.query("COMMIT");
    return result.rows[0]?.user_id ?? null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
