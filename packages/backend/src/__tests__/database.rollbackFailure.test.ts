import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { withPoolTransaction } from "../database/connection.js";
import { isPostgresTestEnvironmentAvailable, startMigratedTestDatabase, type MigratedTestDatabase } from "./databaseTestHarness.js";

const describeWithPostgres = isPostgresTestEnvironmentAvailable() ? describe : describe.skip;

describeWithPostgres("B11 a failing ROLLBACK keeps the original error and never returns a broken client", () => {
  let database: MigratedTestDatabase;
  let pool: Pool;

  beforeAll(async () => {
    database = await startMigratedTestDatabase();
    pool = new Pool({ connectionString: database.connectionString, max: 1 });
    pool.on("error", () => undefined);
  }, 120_000);

  afterAll(async () => {
    await pool.end();
    await database.stop();
  });

  it("rethrows the original error when ROLLBACK fails, and the next query gets a working client", async () => {
    let originalError: unknown;
    const failure = await withPoolTransaction(pool, async (client) => {
      client.on("error", () => undefined);
      await client.query("SELECT pg_terminate_backend(pg_backend_pid())").catch((error: unknown) => {
        originalError = error;
        throw error;
      });
    }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(originalError).toBeInstanceOf(Error);
    expect(failure).toBe(originalError);
    const next = await pool.query<{ answer: number }>("SELECT 1 AS answer");
    expect(next.rows).toEqual([{ answer: 1 }]);
  });

  it("rethrows the original error and keeps the client when ROLLBACK works", async () => {
    const failure = await withPoolTransaction(pool, () => Promise.reject(new RangeError("work failed"))).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(RangeError);
    expect((await pool.query<{ answer: number }>("SELECT 1 AS answer")).rows).toEqual([{ answer: 1 }]);
  });
});
