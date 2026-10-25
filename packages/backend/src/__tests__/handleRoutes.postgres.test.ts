import { Hono, type Context } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { userSchema } from "@bjj-roll/shared";
import { withUserContext } from "../database/connection.js";
import { createHandleRoutes, mountHandleRoutes } from "../handleRoutes.js";
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

function resolveTestHeaderUserId(context: Context): string | null {
  const headerUserId = context.req.header("x-test-user-id")?.trim();
  return headerUserId && headerUserId.length > 0 ? headerUserId : null;
}

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

    const routes = createHandleRoutes(currentHarness.db, {
      resolveAuthenticatedUserId: resolveTestHeaderUserId,
    });

    const initialResponse = await routes.request("/handles/me", {
      headers: { "x-test-user-id": uuidFixtureUser.id },
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
        "x-test-user-id": uuidFixtureUser.id,
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
    const routes = createHandleRoutes(db, {
      resolveAuthenticatedUserId: resolveTestHeaderUserId,
    });

    const freeCheck = await routes.request("/handles/availability?handle=AB_1");
    expect(freeCheck.status).toBe(200);
    expect(await freeCheck.json()).toEqual({ available: true, handle: "ab_1" });

    const claimAlpha = await routes.request("/handles", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-test-user-id": userAlpha.id,
      },
      body: JSON.stringify({ handle: "ab_1" }),
    });
    expect(claimAlpha.status).toBe(200);

    for (const queryVariant of ["ab_1", "AB_1", "  Ab_1  "]) {
      const takenQueryCheck = await routes.request(`/handles/availability?handle=${encodeURIComponent(queryVariant)}`);
      expect(takenQueryCheck.status).toBe(200);
      expect(await takenQueryCheck.json()).toEqual({ available: false, handle: "ab_1" });
    }

    for (const bodyVariant of ["ab_1", "AB_1", "  Ab_1  "]) {
      const conflictBravo = await routes.request("/handles", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-user-id": userBravo.id,
        },
        body: JSON.stringify({ handle: bodyVariant }),
      });
      expect(conflictBravo.status).toBe(409);
    }
  });

  it("allows exactly one of two parallel requests for the same free handle and returns 409 for the other", async () => {
    const { db } = requireHarness();
    const routes = createHandleRoutes(db, {
      resolveAuthenticatedUserId: resolveTestHeaderUserId,
    });

    const [alphaResponse, bravoResponse] = await Promise.all([
      routes.request("/handles", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-user-id": userAlpha.id,
        },
        body: JSON.stringify({ handle: "race_handle" }),
      }),
      routes.request("/handles", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-user-id": userBravo.id,
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

  it("enforces owner RLS as bjj_app so user B cannot set user A's handle and default resolver ignores spoofed headers", async () => {
    const { db } = requireHarness();

    const previousNodeEnvironment = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    try {
      const defaultRoutes = createHandleRoutes(db);
      const spoofedHeaderAttempt = await defaultRoutes.request("/handles", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-authenticated-user-id": userAlpha.id,
        },
        body: JSON.stringify({ handle: "spoofed_handle" }),
      });
      expect(spoofedHeaderAttempt.status).toBe(401);
    } finally {
      if (previousNodeEnvironment === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnvironment;
      }
    }

    const rlsUpdateResult = await withUserContext(db, userBravo.id, (transaction) =>
      transaction.updateTable("users").set({ handle: "bravo_hijack" }).where("id", "=", userAlpha.id).returning(["id", "handle"]).executeTakeFirst(),
    );
    expect(rlsUpdateResult).toBeUndefined();

    const routes = createHandleRoutes(db, {
      resolveAuthenticatedUserId: resolveTestHeaderUserId,
    });
    const extraUserIdFieldAttempt = await routes.request("/handles", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-test-user-id": userBravo.id,
      },
      body: JSON.stringify({ userId: userAlpha.id, handle: "bravo_hijack" }),
    });
    expect(extraUserIdFieldAttempt.status).toBe(400);

    const alphaAfterAttempts = await withUserContext(db, userAlpha.id, (transaction) =>
      transaction.selectFrom("users").select(["handle"]).where("id", "=", userAlpha.id).executeTakeFirstOrThrow(),
    );
    expect(alphaAfterAttempts.handle).toBeNull();

    const sessionContextApp = new Hono<{ Variables: { user: { id: string } } }>();
    sessionContextApp.use("*", async (context, next) => {
      context.set("user", { id: userAlpha.id });
      await next();
    });
    mountHandleRoutes(sessionContextApp as unknown as Hono, db);

    const selfSetAttempt = await sessionContextApp.request("/handles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle: "Alpha_Own" }),
    });
    expect(selfSetAttempt.status).toBe(200);
    const selfSetBody = (await selfSetAttempt.json()) as { handle: string };
    expect(selfSetBody.handle).toBe("alpha_own");
  });
});
