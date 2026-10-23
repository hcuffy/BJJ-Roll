import type { DBAdapter, Where } from "better-auth/adapters";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  betterAuthTelemetryDisabledConfig,
  createEmailHashAdapter,
  lookupUserIdByEmailHmac,
  withAppRoleUnscoped,
  withUserContext,
  type EmailPrivacyCodec,
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

const sampleCodec: EmailPrivacyCodec = {
  keyVersion: 1,
  computeEmailHmac: (email: string) => `hmac:${email.trim().toLowerCase()}`,
  encryptEmail: (email: string) => `v1:enc:${email.trim().toLowerCase()}`,
  decryptEmail: (ciphertext: string) => ciphertext.replace(/^v1:enc:/u, ""),
};

describe.skipIf(!canRunPostgresTests)("database handles and pre-session email HMAC lookup (HEN-58 AC 6, 7)", () => {
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

  it("AC 6: handle column defaults to null, allows multiple nulls, enforces unique set handles, and refuses mixed case", async () => {
    const { db } = requireHarness();

    await withUserContext(db, userAlpha.id, async (transaction) => {
      const alphaRow = await transaction.selectFrom("users").select(["id", "handle"]).executeTakeFirstOrThrow();
      expect(alphaRow.handle).toBeNull();
    });
    await withUserContext(db, userBravo.id, async (transaction) => {
      const bravoRow = await transaction.selectFrom("users").select(["id", "handle"]).executeTakeFirstOrThrow();
      expect(bravoRow.handle).toBeNull();
    });

    await withUserContext(db, userAlpha.id, async (transaction) => {
      const updated = await transaction
        .updateTable("users")
        .set({ handle: "berimbolo_king" })
        .where("id", "=", userAlpha.id)
        .returning(["handle"])
        .executeTakeFirstOrThrow();
      expect(updated.handle).toBe("berimbolo_king");
    });

    await expect(
      withUserContext(db, userBravo.id, (transaction) =>
        transaction.updateTable("users").set({ handle: "berimbolo_king" }).where("id", "=", userBravo.id).execute(),
      ),
    ).rejects.toThrow(/users_handle_unique_idx|duplicate key/iu);

    await expect(
      withUserContext(db, userBravo.id, (transaction) =>
        transaction.updateTable("users").set({ handle: "Mixed_Case" }).where("id", "=", userBravo.id).execute(),
      ),
    ).rejects.toThrow(/users_handle_lowercase_check|check constraint/iu);
  });

  it("AC 7.4 & 7.6: app_user_id_by_email_hmac returns user_id only for known HMAC, null for unknown, while bjj_app sees 0 user rows", async () => {
    const { db, pool } = requireHarness();

    expect(betterAuthTelemetryDisabledConfig).toEqual({ enabled: false });

    const foundAlphaId = await lookupUserIdByEmailHmac(db, userAlpha.emailHash);
    expect(foundAlphaId).toBe(userAlpha.id);

    const foundBravoId = await lookupUserIdByEmailHmac(db, userBravo.emailHash);
    expect(foundBravoId).toBe(userBravo.id);

    const unknownLookup = await lookupUserIdByEmailHmac(db, "hmac-does-not-exist");
    expect(unknownLookup).toBeNull();

    await withAppRoleUnscoped(db, async (transaction) => {
      const directUserRows = await transaction.selectFrom("users").selectAll().execute();
      expect(directUserRows).toEqual([]);
    });

    let lastCreatedPayload: Record<string, unknown> | undefined;
    let lastWhereLookup: Where[] | undefined;
    const stubInnerAdapter = {
      id: "stub",
      create: ({ data }: { model: string; data: Record<string, unknown> }) => {
        lastCreatedPayload = data;
        return Promise.resolve({
          id: userAlpha.id,
          emailCiphertext: data.emailCiphertext,
          emailHash: data.emailHash,
          keyVersion: data.keyVersion,
        });
      },
      findOne: ({ where }: { model: string; where: Where[] }) => {
        lastWhereLookup = where;
        return Promise.resolve({
          id: userAlpha.id,
          emailCiphertext: "v1:enc:alpha@example.com",
          emailHash: userAlpha.emailHash,
          keyVersion: 1,
        });
      },
    } as unknown as DBAdapter;

    const wrappedAdapter = createEmailHashAdapter(stubInnerAdapter, {
      pool,
      codec: {
        ...sampleCodec,
        computeEmailHmac: (email: string) => (email === "alpha@example.com" ? userAlpha.emailHash : `hmac:${email}`),
      },
    });

    const createdUser = await wrappedAdapter.create<Record<string, unknown>>({
      model: "user",
      data: {
        id: userAlpha.id,
        email: "alpha@example.com",
        name: "Should Be Stripped",
        image: "https://example.com/avatar.png",
      },
    });
    expect(lastCreatedPayload).toEqual({
      id: userAlpha.id,
      emailHash: userAlpha.emailHash,
      emailCiphertext: "v1:enc:alpha@example.com",
      keyVersion: 1,
    });
    expect(createdUser).toEqual({
      id: userAlpha.id,
      email: "alpha@example.com",
    });

    const foundByEmail = await wrappedAdapter.findOne<Record<string, unknown>>({
      model: "user",
      where: [{ field: "email", value: "alpha@example.com" }],
    });
    expect(lastWhereLookup).toEqual([{ field: "id", value: userAlpha.id }]);
    expect(foundByEmail).toEqual({
      id: userAlpha.id,
      email: "alpha@example.com",
    });

    const missingByEmail = await wrappedAdapter.findOne<Record<string, unknown>>({
      model: "user",
      where: [{ field: "email", value: "nobody@example.com" }],
    });
    expect(missingByEmail).toBeNull();
  });
});
