import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claimNonceOnce } from "../auth/socialSignInSafety.js";
import { isPostgresTestEnvironmentAvailable } from "./databaseTestHarness.js";
import { startAuthTestEnvironment, type StartedAuthTestEnvironment } from "./authTestHelper.js";

const NONCE_PREFIX = "apple-id-token-nonce:";
const freshClaim = (): string => createHash("sha256").update(randomBytes(32)).digest("hex");

describe.skipIf(!isPostgresTestEnvironmentAvailable())("HEN-239 used Apple nonce rows: cleanup on insert", () => {
  let environment: StartedAuthTestEnvironment | undefined;

  const current = (): StartedAuthTestEnvironment => {
    if (!environment) {
      throw new Error("Auth test environment not initialized");
    }
    return environment;
  };

  /** Seeds a verification row through the admin pool, `secondsFromNow` before or after now. */
  const seedRow = async (identifier: string, secondsFromNow: number): Promise<void> => {
    await current().pool.query(
      `INSERT INTO public.verifications (id, identifier, value, expires_at, created_at, updated_at)
       VALUES ($1, $2, 'used', now() + make_interval(secs => $3), now(), now())`,
      [randomUUID(), identifier, secondsFromNow],
    );
  };

  const rowExists = async (identifier: string): Promise<boolean> =>
    ((await current().pool.query("SELECT 1 FROM public.verifications WHERE identifier = $1", [identifier])).rowCount ?? 0) > 0;

  const expire = async (identifier: string): Promise<void> => {
    await current().pool.query("UPDATE public.verifications SET expires_at = now() - interval '1 second' WHERE identifier = $1", [identifier]);
  };

  beforeAll(async () => {
    environment = await startAuthTestEnvironment();
  }, 60_000);

  afterAll(async () => {
    await environment?.stop();
  }, 30_000);

  it("deletes expired used-nonce rows when it records a new nonce, and keeps unexpired ones", async () => {
    const expired = [`${NONCE_PREFIX}${freshClaim()}`, `${NONCE_PREFIX}${freshClaim()}`];
    const unexpired = `${NONCE_PREFIX}${freshClaim()}`;
    for (const identifier of expired) {
      await seedRow(identifier, -60);
    }
    await seedRow(unexpired, 600);

    expect(await claimNonceOnce(current().appLogin.pool, freshClaim())).toBe(true);

    expect(await Promise.all(expired.map(rowExists))).toEqual([false, false]);
    expect(await rowExists(unexpired)).toBe(true);
  });

  it("leaves other verification rows (email codes, magic links) alone, even when expired", async () => {
    const otherExpired = `sign-in-otp-${freshClaim()}`;
    await seedRow(otherExpired, -60);

    expect(await claimNonceOnce(current().appLogin.pool, freshClaim())).toBe(true);

    expect(await rowExists(otherExpired)).toBe(true);
  });

  it("still refuses a used nonce after other inserts until its row expires", async () => {
    const claim = freshClaim();
    expect(await claimNonceOnce(current().appLogin.pool, claim)).toBe(true);
    expect(await claimNonceOnce(current().appLogin.pool, freshClaim())).toBe(true);
    expect(await claimNonceOnce(current().appLogin.pool, claim)).toBe(false);

    await expire(`${NONCE_PREFIX}${claim}`);
    expect(await claimNonceOnce(current().appLogin.pool, freshClaim())).toBe(true);
    expect(await rowExists(`${NONCE_PREFIX}${claim}`)).toBe(false);
  });

  it("indexes verifications.expires_at (migration 004)", async () => {
    const indexes = await current().pool.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'verifications' AND indexname = 'verifications_expires_at_idx'",
    );
    expect(indexes.rows.map((row) => row.indexdef)).toEqual([
      "CREATE INDEX verifications_expires_at_idx ON public.verifications USING btree (expires_at)",
    ]);
  });
});
