import { handleMaximumLength, handleMinimumLength, reservedHandles } from "../../../shared/dist/index.js";
import { Hono } from "hono";
import type { Kysely } from "kysely";
import { describe, expect, it } from "vitest";
import type { BjjRollDatabase } from "../database/schema.js";
import { mountHandleRoutes } from "../handleRoutes.js";

const stubDatabase = {} as unknown as Kysely<BjjRollDatabase>;
const testUserId = "01964c3a-7f00-7000-8000-000000000001";
const forbiddenRealNameKeys = ["name", "realName", "fullName", "firstName", "lastName", "displayName"];

function createValidationTestApp(): Hono {
  const testApp = new Hono();
  return mountHandleRoutes(testApp, { db: stubDatabase });
}

describe("handleRoutes validation and boundary rules (HEN-64)", () => {
  it("requires authentication when reading or setting a user handle", async () => {
    const testApp = createValidationTestApp();

    const getResponse = await testApp.request("/handles/me");
    expect(getResponse.status).toBe(401);

    const postResponse = await testApp.request("/handles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle: "ab_1" }),
    });
    expect(postResponse.status).toBe(401);
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
          "x-authenticated-user-id": testUserId,
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
            "x-authenticated-user-id": testUserId,
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
          "x-authenticated-user-id": testUserId,
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
