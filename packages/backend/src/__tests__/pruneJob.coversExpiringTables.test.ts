import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pruneExpiredAuthRows } from "../jobs/pruneJob.js";
import {
  createAppRoleLoginPool,
  isPostgresTestEnvironmentAvailable,
  startMigratedTestDatabase,
  type AppRoleLoginPool,
  type MigratedTestDatabase,
} from "./databaseTestHarness.js";

const describeWithPostgres = isPostgresTestEnvironmentAvailable() ? describe : describe.skip;

describeWithPostgres("every table with an expiry or last-request column is pruned", () => {
  let database: MigratedTestDatabase;
  let appLogin: AppRoleLoginPool;

  beforeAll(async () => {
    database = await startMigratedTestDatabase();
    appLogin = await createAppRoleLoginPool(database);
  }, 120_000);

  afterAll(async () => {
    await appLogin.stop();
    await database.stop();
  });

  it("the prune run reports exactly the public tables that have expires_at or last_request", async () => {
    const expiring = await database.pool.query<{ table_name: string }>(
      `SELECT DISTINCT table_name FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name IN ('expires_at', 'last_request')
       ORDER BY table_name`,
    );
    const pruned = await pruneExpiredAuthRows(appLogin.pool);
    expect(pruned.map((result) => result.table).sort()).toEqual(expiring.rows.map((row) => row.table_name));
  });
});
