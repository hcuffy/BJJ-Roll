import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RATE_LIMIT_WINDOW_SECONDS, SESSION_ABSOLUTE_MAX_LIFETIME_SECONDS, SESSION_SLIDING_EXPIRY_SECONDS } from "../auth/authLimits.js";
import { currentMs, secondsAfter, currentDate } from "../dates.js";
import { AUTH_PRUNE_CRON, AUTH_PRUNE_QUEUE_NAME, pruneExpiredAuthRows } from "../jobs/pruneJob.js";
import { BackgroundJobs } from "../jobs/backgroundJobs.js";
import {
  createAppRoleLoginPool,
  isPostgresTestEnvironmentAvailable,
  seedFixtureUser,
  startMigratedTestDatabase,
  userAlpha,
  type AppRoleLoginPool,
  type MigratedTestDatabase,
} from "./databaseTestHarness.js";

const describeWithPostgres = isPostgresTestEnvironmentAvailable() ? describe : describe.skip;

describeWithPostgres("hourly prune of expired sign-in rows, sessions and old rate-limit counters", () => {
  let database: MigratedTestDatabase;
  let appLogin: AppRoleLoginPool;

  beforeAll(async () => {
    database = await startMigratedTestDatabase();
    appLogin = await createAppRoleLoginPool(database);
    await seedFixtureUser(database, userAlpha);
  }, 120_000);

  afterAll(async () => {
    await appLogin.stop();
    await database.stop();
  });

  async function ids(table: "verifications" | "sessions" | "rate_limits"): Promise<string[]> {
    const result = await database.pool.query<{ id: string }>(`SELECT id FROM public.${table} ORDER BY id`);
    return result.rows.map((row) => row.id);
  }

  it("removes expired rows after one run and keeps live ones", async () => {
    const past = secondsAfter(currentDate(), -60);
    await database.pool.query(
      `INSERT INTO public.verifications (id, user_id, identifier, value, expires_at) VALUES
         ('verif-expired-unowned', NULL, 'magic-link:expired', 'sealed', $1),
         ('verif-expired-owned', $2, 'magic-link-exchange:expired', 'sealed', $1)`,
      [past, userAlpha.id],
    );
    await database.pool.query(
      `INSERT INTO public.sessions (id, user_id, token, expires_at, created_at, updated_at)` +
        ` VALUES ('session-expired', $1, 'token-expired', $2, $2, $2)`,
      [userAlpha.id, past],
    );
    const oldCounter = currentMs() - RATE_LIMIT_WINDOW_SECONDS * 1000 - 1000;
    const midWindowCounter = currentMs() - (RATE_LIMIT_WINDOW_SECONDS - 60) * 1000;
    await database.pool.query(
      `INSERT INTO public.rate_limits (id, key, count, last_request)` +
        ` VALUES ('rate-old', 'old|/sign-in/magic-link', 3, $1), ('rate-live', 'live|/sign-in/magic-link', 1, $2),` +
        ` ('rate-mid', 'mid|/sign-in/magic-link', 2, $3)`,
      [oldCounter, currentMs(), midWindowCounter],
    );

    await pruneExpiredAuthRows(appLogin.pool);

    expect(await ids("verifications")).toEqual([userAlpha.verificationByEmailHashId, userAlpha.verificationByUserId].sort());
    expect(await ids("sessions")).toEqual([userAlpha.sessionId]);
    expect(await ids("rate_limits")).toEqual(["rate-live", "rate-mid"]);
  });

  it("never deletes a live session, even one about to expire or near its absolute cap", async () => {
    const now = currentDate();
    const longAgo = secondsAfter(now, -(SESSION_ABSOLUTE_MAX_LIFETIME_SECONDS - 60));
    await database.pool.query(
      `INSERT INTO public.sessions (id, user_id, token, expires_at, created_at, updated_at) VALUES` +
        ` ('session-live-soon', $1, 'token-live-soon', $2, $3, $3),` +
        ` ('session-live-month', $1, 'token-live-month', $4, $3, $3),` +
        ` ('session-live-old', $1, 'token-live-old', $2, $5, $5)`,
      [userAlpha.id, secondsAfter(now, 60), now, secondsAfter(now, SESSION_SLIDING_EXPIRY_SECONDS), longAgo],
    );

    await pruneExpiredAuthRows(appLogin.pool);

    expect(await ids("sessions")).toEqual([userAlpha.sessionId, "session-live-month", "session-live-old", "session-live-soon"].sort());
  });

  it("the app role still cannot read or delete another user's live rows directly", async () => {
    const seen = await appLogin.pool.query("SELECT id FROM public.sessions");
    expect(seen.rows).toEqual([]);
    const deleted = await appLogin.pool.query("DELETE FROM public.verifications");
    expect(deleted.rowCount).toBe(0);
  });

  it("schedules the prune every hour when the background jobs start", async () => {
    const jobs = new BackgroundJobs({
      connectionString: database.connectionString,
      pool: appLogin.pool,
      revokeAppleRefreshToken: () => Promise.resolve(),
    });
    await jobs.start();
    try {
      const schedules = await database.pool.query<{ name: string; cron: string }>("SELECT name, cron FROM pgboss.schedule");
      expect(schedules.rows).toEqual([{ name: AUTH_PRUNE_QUEUE_NAME, cron: AUTH_PRUNE_CRON }]);
      expect(AUTH_PRUNE_CRON).toBe("0 * * * *");
    } finally {
      await jobs.stop();
    }
  }, 60_000);
});
