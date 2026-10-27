import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MAX_VERIFIES_PER_IP_PER_WINDOW } from "../auth/authLimits.js";
import { authIpRateLimitCustomRules } from "../auth/authRateLimits.js";
import { isPostgresTestEnvironmentAvailable } from "./databaseTestHarness.js";
import { getAuthPath, startAuthTestEnvironment, type StartedAuthTestEnvironment } from "./authTestHelper.js";
import { createFakeSocialProviderConfig } from "./socialSignInTestDoubles.js";

/** Far above the /callback/* rule, so a 429 at the rule's max + 1 can only come from the rule itself. */
const RAISED_GLOBAL_MAX = 1000;

// Our global limit and the /callback/* rule are both 20 per 15 minutes, so the real app cannot tell them apart.
// Here the global limit is raised (Better Auth's options only, nothing else changes) to prove the callback rule is applied.
vi.mock("better-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("better-auth")>();
  return {
    ...actual,
    betterAuth: ((options: Parameters<typeof actual.betterAuth>[0]) =>
      actual.betterAuth({ ...options, rateLimit: { ...options.rateLimit, max: RAISED_GLOBAL_MAX } })) as typeof actual.betterAuth,
  };
});

describe.skipIf(!isPostgresTestEnvironmentAvailable())("HEN-239 provider callbacks have their own rate limit", () => {
  let environment: StartedAuthTestEnvironment | undefined;

  beforeAll(async () => {
    environment = await startAuthTestEnvironment({ socialProviders: createFakeSocialProviderConfig() });
  }, 60_000);

  afterAll(async () => {
    await environment?.stop();
  }, 30_000);

  it("blocks callback request max + 1 from one IP by the /callback/* rule, while the global limit would still allow it", async () => {
    const app = environment?.app;
    if (!app) {
      throw new Error("Auth test environment not initialized");
    }
    const ruleMax = MAX_VERIFIES_PER_IP_PER_WINDOW;
    const statuses: number[] = [];
    for (let request = 1; request <= ruleMax + 2; request += 1) {
      const response = await getAuthPath(app, "/callback/google?code=replayed-code&state=not-a-real-state", { ipAddress: "198.51.100.207" });
      statuses.push(response.status);
    }

    expect(statuses.indexOf(429) + 1).toBe(ruleMax + 1);
    expect(statuses.slice(0, ruleMax)).not.toContain(429);
    expect(ruleMax + 1).toBeLessThan(RAISED_GLOBAL_MAX);
    expect(authIpRateLimitCustomRules["/callback/*"]?.max).toBe(ruleMax);
  });
});
