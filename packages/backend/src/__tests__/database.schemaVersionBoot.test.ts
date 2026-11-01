import { randomBytes } from "node:crypto";
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createAppFromEnvironment } from "../app.js";
import { GOOGLE_CLIENT_ID_ENV, GOOGLE_CLIENT_SECRET_ENV, generateTestAuthSecrets } from "../auth/index.js";
import { createDatabase } from "../database/connection.js";
import { migrateDatabaseFromEnvironment, runDatabaseMigrations } from "../database/migrator.js";
import { AUTH_BASE_URL_ENV, DATABASE_URL_ENV, EMAIL_FROM_ADDRESS_ENV, LETTERMINT_API_KEY_ENV } from "../serverConfig.js";
import { isPostgresTestEnvironmentAvailable, startMigratedTestDatabase, type MigratedTestDatabase } from "./databaseTestHarness.js";

const bundledMigrationsDirectory = path.resolve(import.meta.dirname, "../database/migrations");

describe.skipIf(!isPostgresTestEnvironmentAvailable())("B1 boot refuses an out-of-date schema", () => {
  let harness: MigratedTestDatabase | undefined;
  let staleDatabaseUrl = "";
  let partialMigrationsDirectory = "";
  const staleDatabaseName = `bjj_boot_${randomBytes(4).toString("hex")}`;

  beforeAll(async () => {
    harness = await startMigratedTestDatabase();
    await harness.pool.query(`CREATE DATABASE ${staleDatabaseName}`);
    const staleUrl = new URL(harness.connectionString);
    staleUrl.pathname = `/${staleDatabaseName}`;
    staleDatabaseUrl = staleUrl.toString();
    partialMigrationsDirectory = mkdtempSync(path.join(tmpdir(), "bjj-partial-migrations-"));
    const migrationFiles = readdirSync(bundledMigrationsDirectory)
      .filter((fileName) => fileName.endsWith(".sql"))
      .sort();
    for (const fileName of migrationFiles.slice(0, -1)) {
      cpSync(path.join(bundledMigrationsDirectory, fileName), path.join(partialMigrationsDirectory, fileName));
    }
    const staleDatabase = createDatabase(new Pool({ connectionString: staleDatabaseUrl }));
    await runDatabaseMigrations(staleDatabase, partialMigrationsDirectory);
    await staleDatabase.destroy();
  }, 120_000);

  afterAll(async () => {
    rmSync(partialMigrationsDirectory, { recursive: true, force: true });
    await harness?.pool.query(`DROP DATABASE IF EXISTS ${staleDatabaseName} WITH (FORCE)`);
    await harness?.stop();
  }, 30_000);

  const bootEnvironment = (): Record<string, string> => ({
    ...generateTestAuthSecrets(),
    [AUTH_BASE_URL_ENV]: "https://api.example.test",
    [DATABASE_URL_ENV]: staleDatabaseUrl,
    [LETTERMINT_API_KEY_ENV]: "lm-test-value-not-a-secret",
    [EMAIL_FROM_ADDRESS_ENV]: "login@example.test",
    [GOOGLE_CLIENT_ID_ENV]: "test-google-client.apps.example.test",
    [GOOGLE_CLIENT_SECRET_ENV]: "test-google-secret-not-real",
  });

  it("exits 1 with schema_out_of_date when the last migration is missing, and boots after migrate", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${String(code)})`);
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(createAppFromEnvironment(bootEnvironment())).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy.mock.calls.flat().join(" ")).toContain("schema_out_of_date");

    exitSpy.mockClear();
    await migrateDatabaseFromEnvironment(bootEnvironment());
    const booted = await createAppFromEnvironment(bootEnvironment());
    expect(exitSpy).not.toHaveBeenCalled();
    expect((await booted.app.request("http://localhost/health")).status).toBe(200);
    await booted.pool.end();
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  }, 60_000);
});
