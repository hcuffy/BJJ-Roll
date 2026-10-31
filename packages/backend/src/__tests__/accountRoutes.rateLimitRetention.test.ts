import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_SENDS_PER_EMAIL_PER_WINDOW } from "../auth/authLimits.js";
import { emailRateLimitKey } from "../auth/authRateLimits.js";
import { isPostgresTestEnvironmentAvailable } from "./databaseTestHarness.js";
import { createAccountTestFlow } from "./accountTestFlow.js";
import { postAuthJson, startAuthTestEnvironment, type StartedAuthTestEnvironment, currentSignUpAttestation } from "./authTestHelper.js";

describe.skipIf(!isPostgresTestEnvironmentAvailable())("HEN-65 account delete keeps the per-email send counter (Sara, 25 Oct)", () => {
  let environment: StartedAuthTestEnvironment | undefined;

  const current = (): StartedAuthTestEnvironment => {
    if (!environment) {
      throw new Error("Auth test environment not initialized");
    }
    return environment;
  };

  beforeAll(async () => {
    environment = await startAuthTestEnvironment();
  }, 60_000);

  afterAll(async () => {
    await environment?.stop();
  }, 30_000);

  const email = "limit.survives@example.com";
  const ipAddress = "198.51.100.106";

  const sendOtp = (): Promise<Response> =>
    postAuthJson(current().app, "/email-otp/send-verification-otp", {
      body: { email, type: "sign-in", age16Confirmed: true, ...currentSignUpAttestation },
      ipAddress,
    });

  const { signIn, deleteAccount } = createAccountTestFlow(current);

  const emailRateLimitRows = async (): Promise<{ count: number }[]> => {
    const result = await current().pool.query<{ count: number }>("SELECT count FROM public.rate_limits WHERE key = $1", [
      emailRateLimitKey(current().codec.computeEmailHmac(email)),
    ]);
    return result.rows;
  };

  it("the counter row survives DELETE /account, and re-signup with the same email still hits the 3-per-window limit", async () => {
    expect(MAX_SENDS_PER_EMAIL_PER_WINDOW).toBe(3);

    const original = await signIn(email, ipAddress);
    const deleteResponse = await deleteAccount(original);
    expect(deleteResponse.status).toBe(200);
    expect((await current().pool.query("SELECT id FROM public.users WHERE id = $1", [original.userId])).rows).toEqual([]);
    expect(await emailRateLimitRows()).toEqual([{ count: 2 }]);

    const returning = await signIn(email, ipAddress);
    expect(returning.userId).not.toBe(original.userId);
    expect((await sendOtp()).status).toBe(429);
    expect(await emailRateLimitRows()).toEqual([{ count: MAX_SENDS_PER_EMAIL_PER_WINDOW + 1 }]);
  });
});
