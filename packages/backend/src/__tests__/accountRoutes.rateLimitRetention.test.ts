import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_SENDS_PER_EMAIL_PER_WINDOW } from "../auth/authLimits.js";
import { emailRateLimitKey } from "../auth/authRateLimits.js";
import { isPostgresTestEnvironmentAvailable } from "./databaseTestHarness.js";
import { extractSessionCookie, postAuthJson, startAuthTestEnvironment, testBaseUrl, type StartedAuthTestEnvironment } from "./authTestHelper.js";

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
    postAuthJson(current().app, "/email-otp/send-verification-otp", { body: { email, type: "sign-in", ageConfirmed: true }, ipAddress });

  const signIn = async (): Promise<{ cookie: string; userId: string }> => {
    expect((await sendOtp()).status).toBe(200);
    const sent = current()
      .emailSender.sentMessages.filter((message) => message.kind === "one_time_code" && message.to.toLowerCase() === email)
      .at(-1);
    if (sent?.kind !== "one_time_code") {
      throw new Error(`No OTP sent for ${email}`);
    }
    const response = await postAuthJson(current().app, "/sign-in/email-otp", { body: { email, otp: sent.code }, ipAddress });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { user: { id: string } };
    return { cookie: extractSessionCookie(response), userId: body.user.id };
  };

  const emailRateLimitRows = async (): Promise<{ count: number }[]> => {
    const result = await current().pool.query<{ count: number }>("SELECT count FROM public.rate_limits WHERE key = $1", [
      emailRateLimitKey(current().codec.computeEmailHmac(email)),
    ]);
    return result.rows;
  };

  it("the counter row survives DELETE /account, and re-signup with the same email still hits the 3-per-window limit", async () => {
    expect(MAX_SENDS_PER_EMAIL_PER_WINDOW).toBe(3);

    // Two of the three sends in the window: one used to sign in, one left unused.
    const original = await signIn();
    expect((await sendOtp()).status).toBe(200);
    expect(await emailRateLimitRows()).toEqual([{ count: 2 }]);

    const deleteResponse = await current().app.request(`${testBaseUrl}/account`, { method: "DELETE", headers: { cookie: original.cookie } });
    expect(deleteResponse.status).toBe(200);
    expect((await current().pool.query("SELECT id FROM public.users WHERE id = $1", [original.userId])).rows).toEqual([]);
    expect(await emailRateLimitRows()).toEqual([{ count: 2 }]);

    // Re-signup spends the third and last send of the window; the next send is refused.
    const returning = await signIn();
    expect(returning.userId).not.toBe(original.userId);
    expect((await sendOtp()).status).toBe(429);
    // The refused send is counted too (existing limiter behaviour), so the window keeps refusing until it expires.
    expect(await emailRateLimitRows()).toEqual([{ count: MAX_SENDS_PER_EMAIL_PER_WINDOW + 1 }]);
  });
});
