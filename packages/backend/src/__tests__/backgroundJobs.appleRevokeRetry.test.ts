import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APPLE_REVOKE_QUEUE_NAME, BackgroundJobs } from "../jobs/backgroundJobs.js";
import type { ServerEventLine } from "../serverProcess.js";
import {
  createAppRoleLoginPool,
  isPostgresTestEnvironmentAvailable,
  startMigratedTestDatabase,
  type AppRoleLoginPool,
  type MigratedTestDatabase,
} from "./databaseTestHarness.js";
import { waitUntil } from "./emailQueueTestSupport.js";

const describeWithPostgres = isPostgresTestEnvironmentAvailable() ? describe : describe.skip;

describeWithPostgres("B9 Apple revoke retry job", () => {
  let database: MigratedTestDatabase;
  let appLogin: AppRoleLoginPool;
  let jobs: BackgroundJobs;
  const attempts = new Map<string, number>();
  const failuresBeforeSuccess = new Map<string, number>();
  const logLines: ServerEventLine[] = [];

  const jobRows = async (): Promise<number> => {
    const result = await database.pool.query<{ count: number }>("SELECT count(*)::int AS count FROM pgboss.job WHERE name = $1", [
      APPLE_REVOKE_QUEUE_NAME,
    ]);
    return result.rows[0]?.count ?? -1;
  };

  beforeAll(async () => {
    database = await startMigratedTestDatabase();
    appLogin = await createAppRoleLoginPool(database);
    jobs = new BackgroundJobs({
      connectionString: database.connectionString,
      pool: appLogin.pool,
      revokeAppleRefreshToken: (sealed) => {
        const count = (attempts.get(sealed) ?? 0) + 1;
        attempts.set(sealed, count);
        return count > (failuresBeforeSuccess.get(sealed) ?? 0) ? Promise.resolve() : Promise.reject(new Error(`Apple said no to ${sealed}`));
      },
      logEvent: (line) => logLines.push(line),
      pollingIntervalSeconds: 0.5,
      appleRevokeRetry: { retryLimit: 2, retryDelaySeconds: 1 },
    });
    await jobs.start();
  }, 120_000);

  afterAll(async () => {
    await jobs.stop();
    await appLogin.stop();
    await database.stop();
  }, 60_000);

  it("retries until Apple takes the revoke, then removes the job", async () => {
    failuresBeforeSuccess.set("sealed-flaky", 2);
    await jobs.enqueue("sealed-flaky");
    await waitUntil(() => attempts.get("sealed-flaky") === 3, 30_000);
    await waitUntil(async () => (await jobRows()) === 0);
    expect(logLines.filter((line) => line.event === "apple_revoke_dead_lettered")).toEqual([]);
  }, 60_000);

  it("gives up after the last retry with one log line that has no token, and removes the job", async () => {
    failuresBeforeSuccess.set("sealed-refused", 99);
    await jobs.enqueue("sealed-refused");
    await waitUntil(() => logLines.some((line) => line.event === "apple_revoke_dead_lettered"), 30_000);
    expect(attempts.get("sealed-refused")).toBe(3);
    const deadLetters = logLines.filter((line) => line.event === "apple_revoke_dead_lettered");
    expect(deadLetters).toEqual([{ event: "apple_revoke_dead_lettered", jobId: expect.any(String) as string, reason: "revoke_failed", attempts: 3 }]);
    expect(JSON.stringify(logLines)).not.toContain("sealed-refused");
    await waitUntil(async () => (await jobRows()) === 0);
  }, 60_000);

  it("a malformed job is dropped without a revoke call and logged without its content", async () => {
    const boss = new PgBoss({ connectionString: database.connectionString, schedule: false, supervise: false });
    await boss.start();
    try {
      await boss.send(APPLE_REVOKE_QUEUE_NAME, { unexpected: "secret-looking-value" });
    } finally {
      await boss.stop({ graceful: false });
    }
    await waitUntil(() => logLines.some((line) => line.event === "apple_revoke_dead_lettered" && line.reason === "malformed_job"), 30_000);
    expect(JSON.stringify(logLines)).not.toContain("secret-looking-value");
    expect([...attempts.keys()].some((key) => key.includes("secret-looking-value"))).toBe(false);
    await waitUntil(async () => (await jobRows()) === 0);
  }, 60_000);
});
