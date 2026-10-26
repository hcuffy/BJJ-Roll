import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  accountDeletionCascadeMap,
  cascadeDeleteUserAccount,
  createUserAccountRoutes,
  userDataTables,
  withAppRoleUnscoped,
  withUserContext,
} from "../database/index.js";
import {
  isPostgresTestEnvironmentAvailable,
  seedFixtureUser,
  startMigratedTestDatabase,
  userAlpha,
  userBravo,
  type MigratedTestDatabase,
} from "./databaseTestHarness.js";

const canRunPostgresTests = isPostgresTestEnvironmentAvailable();

describe.skipIf(!canRunPostgresTests)("database RLS and cascade delete (HEN-58 AC 2, 3, 5)", () => {
  let harness: MigratedTestDatabase | undefined;

  beforeAll(async () => {
    harness = await startMigratedTestDatabase();
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
  }, 60_000);

  function requireHarness(): MigratedTestDatabase {
    if (!harness) {
      throw new Error("Test database harness was not initialized");
    }
    return harness;
  }

  beforeEach(async () => {
    const currentHarness = requireHarness();
    await currentHarness.pool.query("TRUNCATE TABLE public.verifications, public.sessions, public.accounts, public.users CASCADE");
    await seedFixtureUser(currentHarness, userAlpha);
    await seedFixtureUser(currentHarness, userBravo);
  });

  it("AC 5: with app.user_id unset, bjj_app reads 0 rows from every user-data table", async () => {
    const { db } = requireHarness();

    await withAppRoleUnscoped(db, async (transaction) => {
      const usersRows = await transaction.selectFrom("users").selectAll().execute();
      const sessionsRows = await transaction.selectFrom("sessions").selectAll().execute();
      const accountsRows = await transaction.selectFrom("accounts").selectAll().execute();
      const verificationsRows = await transaction.selectFrom("verifications").selectAll().execute();

      expect(usersRows).toEqual([]);
      expect(sessionsRows).toEqual([]);
      expect(accountsRows).toEqual([]);
      expect(verificationsRows).toEqual([]);
    });

    await withUserContext(db, "", async (transaction) => {
      const usersRows = await transaction.selectFrom("users").selectAll().execute();
      expect(usersRows).toEqual([]);
    });
  });

  it("AC 3: user B cannot read, update or delete user A's rows directly as bjj_app or through the HTTP API", async () => {
    const { db } = requireHarness();

    await withUserContext(db, userBravo.id, async (transaction) => {
      const alphaUsers = await transaction.selectFrom("users").selectAll().where("id", "=", userAlpha.id).execute();
      const alphaSessions = await transaction.selectFrom("sessions").selectAll().where("userId", "=", userAlpha.id).execute();
      const alphaAccounts = await transaction.selectFrom("accounts").selectAll().where("userId", "=", userAlpha.id).execute();
      const alphaVerifications = await transaction
        .selectFrom("verifications")
        .selectAll()
        .where("id", "in", [userAlpha.verificationByUserId, userAlpha.verificationByEmailHashId])
        .execute();

      expect(alphaUsers).toEqual([]);
      expect(alphaSessions).toEqual([]);
      expect(alphaAccounts).toEqual([]);
      expect(alphaVerifications).toEqual([]);

      const updatedUser = await transaction
        .updateTable("users")
        .set({ handle: "hijacked_by_bravo" })
        .where("id", "=", userAlpha.id)
        .executeTakeFirst();
      const updatedSession = await transaction
        .updateTable("sessions")
        .set({ token: "hijacked-token" })
        .where("userId", "=", userAlpha.id)
        .executeTakeFirst();
      const updatedVerification = await transaction
        .updateTable("verifications")
        .set({ value: "hijacked-otp" })
        .where("id", "=", userAlpha.verificationByUserId)
        .executeTakeFirst();

      expect(Number(updatedUser.numUpdatedRows ?? 0n)).toBe(0);
      expect(Number(updatedSession.numUpdatedRows ?? 0n)).toBe(0);
      expect(Number(updatedVerification.numUpdatedRows ?? 0n)).toBe(0);

      const deletedUser = await transaction.deleteFrom("users").where("id", "=", userAlpha.id).executeTakeFirst();
      const deletedSession = await transaction.deleteFrom("sessions").where("userId", "=", userAlpha.id).executeTakeFirst();
      const deletedVerification = await transaction.deleteFrom("verifications").where("id", "=", userAlpha.verificationByUserId).executeTakeFirst();

      expect(Number(deletedUser.numDeletedRows ?? 0n)).toBe(0);
      expect(Number(deletedSession.numDeletedRows ?? 0n)).toBe(0);
      expect(Number(deletedVerification.numDeletedRows ?? 0n)).toBe(0);

      await expect(
        transaction
          .insertInto("sessions")
          .values({
            id: "forged-session",
            userId: userAlpha.id,
            token: "forged-token",
            expiresAt: new Date(Date.now() + 60_000),
            ipAddress: null,
            userAgent: null,
          })
          .execute(),
      ).rejects.toThrow(/row-level security/iu);
    });

    const previousNodeEnvironment = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      expect(() => createUserAccountRoutes(db)).toThrow(/test-only RLS harness/iu);
    } finally {
      process.env.NODE_ENV = previousNodeEnvironment;
    }

    const apiRouter = createUserAccountRoutes(db);
    const readAsBravo = await apiRouter.request(`/users/${userAlpha.id}`, {
      method: "GET",
      headers: { "x-authenticated-user-id": userBravo.id },
    });
    expect(readAsBravo.status).toBe(404);

    const patchAsBravo = await apiRouter.request(`/users/${userAlpha.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-authenticated-user-id": userBravo.id,
      },
      body: JSON.stringify({ handle: "stolen_handle" }),
    });
    expect(patchAsBravo.status).toBe(404);

    const deleteAsBravo = await apiRouter.request(`/users/${userAlpha.id}`, {
      method: "DELETE",
      headers: { "x-authenticated-user-id": userBravo.id },
    });
    expect(deleteAsBravo.status).toBe(404);

    const readAsAlpha = await apiRouter.request(`/users/${userAlpha.id}`, {
      method: "GET",
      headers: { "x-authenticated-user-id": userAlpha.id },
    });
    expect(readAsAlpha.status).toBe(200);
    const alphaPayload = (await readAsAlpha.json()) as { id: string; handle: string | null };
    expect(alphaPayload).toMatchObject({ id: userAlpha.id, handle: null });
  });

  it("AC 3 regression: user B cannot tamper with email_hash ('', '%', substring) and sees 0 of A's verifications", async () => {
    const { db, pool } = requireHarness();

    const tamperedEmailHashes = ["", "%", "aaaa1111", "c".repeat(64), userAlpha.emailHash];
    for (const candidateHash of tamperedEmailHashes) {
      await expect(
        withUserContext(db, userBravo.id, (transaction) =>
          transaction.updateTable("users").set({ emailHash: candidateHash }).where("id", "=", userBravo.id).execute(),
        ),
      ).rejects.toThrow(/permission denied/iu);
    }

    await expect(
      withUserContext(db, userBravo.id, (transaction) =>
        transaction.updateTable("users").set({ id: userAlpha.id }).where("id", "=", userBravo.id).execute(),
      ),
    ).rejects.toThrow(/permission denied/iu);

    for (const invalidFormatHash of ["", "%", "aaaa1111", `UPPERCASE${"a".repeat(55)}`]) {
      await expect(pool.query("UPDATE public.users SET email_hash = $1 WHERE id = $2", [invalidFormatHash, userBravo.id])).rejects.toThrow(
        /users_email_hash_sha256_hex_check|check constraint/iu,
      );
    }

    await withUserContext(db, userBravo.id, async (transaction) => {
      const visibleVerifications = await transaction.selectFrom("verifications").select(["id", "identifier", "value"]).orderBy("id").execute();
      expect(visibleVerifications.map((row) => row.id)).toEqual([userBravo.verificationByEmailHashId, userBravo.verificationByUserId]);

      const deleteAlphaVerifications = await transaction
        .deleteFrom("verifications")
        .where("id", "in", [userAlpha.verificationByUserId, userAlpha.verificationByEmailHashId])
        .executeTakeFirst();
      expect(Number(deleteAlphaVerifications.numDeletedRows ?? 0n)).toBe(0);
    });

    const alphaVerificationsStillIntact = await pool.query<{ id: string }>(
      "SELECT id FROM public.verifications WHERE id = ANY($1::text[]) ORDER BY id",
      [[userAlpha.verificationByUserId, userAlpha.verificationByEmailHashId]],
    );
    expect(alphaVerificationsStillIntact.rows).toEqual([{ id: userAlpha.verificationByEmailHashId }, { id: userAlpha.verificationByUserId }]);
  });

  it("AC 2: deleting a user cascades and removes their sessions, accounts, and OTP/verification rows", async () => {
    const { db, pool } = requireHarness();

    expect(accountDeletionCascadeMap.map((entry) => entry.table)).toEqual(["verifications", "sessions", "accounts", "consent_records", "users"]);
    expect(new Set(accountDeletionCascadeMap.map((entry) => entry.table))).toEqual(new Set(userDataTables));

    await withUserContext(db, userAlpha.id, async (transaction) => {
      await transaction.deleteFrom("users").where("id", "=", userAlpha.id).execute();
    });

    const remainingAlphaSessions = await pool.query("SELECT id FROM public.sessions WHERE user_id = $1", [userAlpha.id]);
    const remainingAlphaAccounts = await pool.query("SELECT id FROM public.accounts WHERE user_id = $1", [userAlpha.id]);
    const remainingAlphaVerifications = await pool.query("SELECT id FROM public.verifications WHERE id = ANY($1::text[])", [
      [userAlpha.verificationByUserId, userAlpha.verificationByEmailHashId],
    ]);
    expect(remainingAlphaSessions.rows).toEqual([]);
    expect(remainingAlphaAccounts.rows).toEqual([]);
    expect(remainingAlphaVerifications.rows).toEqual([]);

    const cascadeResult = await cascadeDeleteUserAccount(db, userBravo.id);
    expect(cascadeResult).toEqual({
      deletedUserCount: 1,
      deletedSessionCount: 1,
      deletedAccountCount: 1,
      deletedVerificationCount: 2,
    });

    const totalRemaining = await pool.query<{ count: number }>(
      `SELECT (
         (SELECT count(*) FROM public.users) +
         (SELECT count(*) FROM public.sessions) +
         (SELECT count(*) FROM public.accounts) +
         (SELECT count(*) FROM public.verifications)
       )::int AS count`,
    );
    expect(totalRemaining.rows[0]?.count).toBe(0);
  });
});
