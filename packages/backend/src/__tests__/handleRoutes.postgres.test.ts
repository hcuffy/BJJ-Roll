import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { userSchema } from "../../../shared/dist/index.js";
import { withUserContext } from "../database/connection.js";
import { createHandleRoutes } from "../handleRoutes.js";
import {
  isPostgresTestEnvironmentAvailable,
  seedFixtureUser,
  startMigratedTestDatabase,
  userAlpha,
  userBravo,
  type MigratedTestDatabase,
  type SeededUserFixture,
} from "./databaseTestHarness.js";

const canRunPostgresTests = isPostgresTestEnvironmentAvailable();

const uuidFixtureUser: SeededUserFixture = {
  id: "01964c3a-7f00-7000-8000-000000000001",
  emailCiphertext: "v1:uuid-user-ciphertext",
  emailHash: "cccc3333cccc3333cccc3333cccc3333cccc3333cccc3333cccc3333cccc3333",
  sessionId: "session-uuid-003",
  sessionToken: "token-uuid-003",
  accountId: "account-uuid-003",
  verificationByUserId: "verif-uuid-user-003",
  verificationByEmailHashId: "verif-uuid-hmac-003",
};

describe.skipIf(!canRunPostgresTests)("handleRoutes Postgres integration (HEN-64)", () => {
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

  it("starts a new user with handle null, validates with userSchema, and stores lowercased handle on set", async () => {
    const currentHarness = requireHarness();
    await seedFixtureUser(currentHarness, uuidFixtureUser);

    const routes = createHandleRoutes(currentHarness.db);

    const initialResponse = await routes.request("/handles/me", {
      headers: { "x-authenticated-user-id": uuidFixtureUser.id },
    });
    expect(initialResponse.status).toBe(200);
    const initialBody: unknown = await initialResponse.json();
    const parsedInitial = userSchema.parse(initialBody);
    expect(parsedInitial.handle).toBeNull();
    expect(Object.keys(initialBody as Record<string, unknown>).sort()).toEqual(["createdAt", "handle", "id"]);

    const setResponse = await routes.request("/handles", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-authenticated-user-id": uuidFixtureUser.id,
      },
      body: JSON.stringify({ handle: "  ABC  " }),
    });
    expect(setResponse.status).toBe(200);
    const setBody: unknown = await setResponse.json();
    const parsedUpdated = userSchema.parse(setBody);
    expect(parsedUpdated.handle).toBe("abc");

    const storedRow = await withUserContext(currentHarness.db, uuidFixtureUser.id, (transaction) =>
      transaction.selectFrom("users").select(["id", "handle"]).where("id", "=", uuidFixtureUser.id).executeTakeFirstOrThrow(),
    );
    expect(storedRow.handle).toBe("abc");
  });

  it("returns available: false and HTTP 409 when a handle is already taken in any case", async () => {
    const { db } = requireHarness();
    const routes = createHandleRoutes(db);

    const freeCheck = await routes.request("/handles/availability?handle=AB_1");
    expect(freeCheck.status).toBe(200);
    expect(await freeCheck.json()).toEqual({ available: true, handle: "ab_1" });

    const claimAlpha = await routes.request("/handles", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-authenticated-user-id": userAlpha.id,
      },
      body: JSON.stringify({ handle: "ab_1" }),
    });
    expect(claimAlpha.status).toBe(200);

    for (const queryVariant of ["ab_1", "AB_1", "  Ab_1  "]) {
      const takenQueryCheck = await routes.request(`/handles/availability?handle=${encodeURIComponent(queryVariant)}`);
      expect(takenQueryCheck.status).toBe(200);
      expect(await takenQueryCheck.json()).toEqual({ available: false, handle: "ab_1" });
    }

    const takenPathCheck = await routes.request("/handles/AB_1/availability");
    expect(takenPathCheck.status).toBe(200);
    expect(await takenPathCheck.json()).toEqual({ available: false, handle: "ab_1" });

    for (const bodyVariant of ["ab_1", "AB_1", "  Ab_1  "]) {
      const conflictBravo = await routes.request("/handles", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-authenticated-user-id": userBravo.id,
        },
        body: JSON.stringify({ handle: bodyVariant }),
      });
      expect(conflictBravo.status).toBe(409);
    }
  });

  it("allows exactly one of two parallel requests for the same free handle and returns 409 for the other", async () => {
    const { db } = requireHarness();
    const routes = createHandleRoutes(db);

    const [alphaResponse, bravoResponse] = await Promise.all([
      routes.request("/handles", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-authenticated-user-id": userAlpha.id,
        },
        body: JSON.stringify({ handle: "race_handle" }),
      }),
      routes.request("/handles", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-authenticated-user-id": userBravo.id,
        },
        body: JSON.stringify({ handle: "RACE_HANDLE" }),
      }),
    ]);

    const statuses = [alphaResponse.status, bravoResponse.status].sort((first, second) => first - second);
    expect(statuses).toEqual([200, 409]);

    const alphaRow = await withUserContext(db, userAlpha.id, (transaction) =>
      transaction.selectFrom("users").select(["handle"]).where("id", "=", userAlpha.id).executeTakeFirstOrThrow(),
    );
    const bravoRow = await withUserContext(db, userBravo.id, (transaction) =>
      transaction.selectFrom("users").select(["handle"]).where("id", "=", userBravo.id).executeTakeFirstOrThrow(),
    );
    const assignedHandles = [alphaRow.handle, bravoRow.handle].filter((handle) => handle !== null);
    expect(assignedHandles).toEqual(["race_handle"]);
  });

  it("enforces owner RLS as bjj_app so user B cannot set user A's handle", async () => {
    const { db } = requireHarness();
    const routes = createHandleRoutes(db);

    const crossUserAttempt = await routes.request(`/users/${userAlpha.id}/handle`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-authenticated-user-id": userBravo.id,
      },
      body: JSON.stringify({ handle: "bravo_hijack" }),
    });
    expect(crossUserAttempt.status).toBe(404);

    const alphaBefore = await withUserContext(db, userAlpha.id, (transaction) =>
      transaction.selectFrom("users").select(["handle"]).where("id", "=", userAlpha.id).executeTakeFirstOrThrow(),
    );
    expect(alphaBefore.handle).toBeNull();

    const selfSetAttempt = await routes.request(`/users/${userAlpha.id}/handle`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-authenticated-user-id": userAlpha.id,
      },
      body: JSON.stringify({ handle: "Alpha_Own" }),
    });
    expect(selfSetAttempt.status).toBe(200);
    const selfSetBody = (await selfSetAttempt.json()) as { handle: string };
    expect(selfSetBody.handle).toBe("alpha_own");
  });
});
