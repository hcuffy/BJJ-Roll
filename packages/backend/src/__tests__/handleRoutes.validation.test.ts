import { Hono, type Context } from "hono";
import type { Kysely } from "kysely";
import { describe, expect, it } from "vitest";
import { handleMaximumLength, handleMinimumLength, reservedHandles } from "../../../shared/dist/index.js";
import type { BjjRollDatabase } from "../database/schema.js";
import { createHandleRoutes, isUniqueHandleConflict, mountHandleRoutes } from "../handleRoutes.js";

const stubDatabase = {} as unknown as Kysely<BjjRollDatabase>;
const testUserId = "01964c3a-7f00-7000-8000-000000000001";
const forbiddenRealNameKeys = ["name", "realName", "fullName", "firstName", "lastName", "displayName"];

function resolveTestHeaderUserId(context: Context): string | null {
  const headerUserId = context.req.header("x-test-user-id")?.trim();
  return headerUserId && headerUserId.length > 0 ? headerUserId : null;
}

function createValidationTestApp(): Hono {
  const testApp = new Hono();
  return mountHandleRoutes(testApp, stubDatabase, {
    resolveAuthenticatedUserId: resolveTestHeaderUserId,
  });
}

describe("handleRoutes validation and boundary rules (HEN-64)", () => {
  it("rejects header-only requests with 401 on default createHandleRoutes(db) when NODE_ENV is unset or non-production", async () => {
    const previousNodeEnvironment = process.env.NODE_ENV;
    const defaultRoutes = createHandleRoutes(stubDatabase);

    try {
      for (const candidateNodeEnvironment of [undefined, "", "development", "test", "production"]) {
        if (candidateNodeEnvironment === undefined) {
          delete process.env.NODE_ENV;
        } else {
          process.env.NODE_ENV = candidateNodeEnvironment;
        }

        const getResponse = await defaultRoutes.request("/handles/me", {
          headers: {
            "x-authenticated-user-id": testUserId,
            "x-test-user-id": testUserId,
          },
        });
        expect(getResponse.status).toBe(401);

        const postResponse = await defaultRoutes.request("/handles", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-authenticated-user-id": testUserId,
            "x-test-user-id": testUserId,
          },
          body: JSON.stringify({ handle: "ab_1" }),
        });
        expect(postResponse.status).toBe(401);
      }
    } finally {
      if (previousNodeEnvironment === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnvironment;
      }
    }
  });

  it("exposes only GET /handles/availability, GET /handles/me, and POST /handles", async () => {
    const testApp = createValidationTestApp();

    const putResponse = await testApp.request("/handles", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-test-user-id": testUserId,
      },
      body: JSON.stringify({ handle: "ab_1" }),
    });
    expect(putResponse.status).toBe(404);

    const patchResponse = await testApp.request("/handles", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-test-user-id": testUserId,
      },
      body: JSON.stringify({ handle: "ab_1" }),
    });
    expect(patchResponse.status).toBe(404);

    const userPathResponse = await testApp.request(`/users/${testUserId}/handle`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-test-user-id": testUserId,
      },
      body: JSON.stringify({ handle: "ab_1" }),
    });
    expect(userPathResponse.status).toBe(404);
  });

  it("matches only 23505 on users_handle_unique_idx in isUniqueHandleConflict", () => {
    expect(isUniqueHandleConflict({ code: "23505", constraint: "users_handle_unique_idx" })).toBe(true);
    expect(isUniqueHandleConflict({ code: "23505", constraint: "users_email_hash_key" })).toBe(false);
    expect(isUniqueHandleConflict({ code: "23505" })).toBe(false);
    expect(isUniqueHandleConflict({ code: "23514", constraint: "users_handle_unique_idx" })).toBe(false);
    expect(isUniqueHandleConflict(null)).toBe(false);
  });

  it("rejects invalid handle formats and boundary violations using limits constants", async () => {
    const testApp = createValidationTestApp();
    const invalidHandles = ["a".repeat(handleMinimumLength - 1), "a".repeat(handleMaximumLength + 1), "a-b", "a.b", "a b", "äbc", "élan"];

    for (const candidate of invalidHandles) {
      const availabilityResponse = await testApp.request(`/handles/availability?handle=${encodeURIComponent(candidate)}`);
      expect(availabilityResponse.status, `expected 400 for availability "${candidate}"`).toBe(400);
      const availabilityBody = (await availabilityResponse.json()) as { available: boolean };
      expect(availabilityBody.available).toBe(false);

      const setResponse = await testApp.request("/handles", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-user-id": testUserId,
        },
        body: JSON.stringify({ handle: candidate }),
      });
      expect(setResponse.status, `expected 400 for POST /handles "${candidate}"`).toBe(400);
    }
  });

  it("rejects every reserved handle in any case across availability and set routes", async () => {
    const testApp = createValidationTestApp();

    for (const reserved of reservedHandles) {
      for (const variant of [reserved, reserved.toUpperCase(), `  ${reserved.toUpperCase()}  `]) {
        const availabilityResponse = await testApp.request(`/handles/availability?handle=${encodeURIComponent(variant)}`);
        expect(availabilityResponse.status).toBe(400);
        const availabilityBody = (await availabilityResponse.json()) as { available: boolean };
        expect(availabilityBody.available).toBe(false);

        const setResponse = await testApp.request("/handles", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-test-user-id": testUserId,
          },
          body: JSON.stringify({ handle: variant }),
        });
        expect(setResponse.status).toBe(400);
      }
    }
  });

  it("rejects payloads that include any real-name field", async () => {
    const testApp = createValidationTestApp();

    for (const forbiddenKey of forbiddenRealNameKeys) {
      const response = await testApp.request("/handles", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-user-id": testUserId,
        },
        body: JSON.stringify({
          handle: "ab_1",
          [forbiddenKey]: "Real Name",
        }),
      });
      expect(response.status, `expected 400 when "${forbiddenKey}" is sent`).toBe(400);
    }
  });
});
