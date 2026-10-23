import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  DEEP_LINK_CALLBACK_URL,
  MAX_SENDS_PER_EMAIL_PER_WINDOW,
  MAX_SENDS_PER_IP_PER_WINDOW,
  MAX_VERIFIES_PER_IP_PER_WINDOW,
  SESSION_ABSOLUTE_MAX_LIFETIME_SECONDS,
} from "../auth/index.js";
import { withAppRoleUnscoped, withUserContext } from "../database/index.js";
import { isPostgresTestEnvironmentAvailable } from "./databaseTestHarness.js";
import { extractSessionCookie, getAuthPath, postAuthJson, startAuthTestEnvironment, type StartedAuthTestEnvironment } from "./authTestHelper.js";

describe.skipIf(!isPostgresTestEnvironmentAvailable())("HEN-71 PG rate limits, session sliding + 90d cap, RLS lookup, and zero-PII logs", () => {
  let environment: StartedAuthTestEnvironment | undefined;

  const current = (): StartedAuthTestEnvironment => {
    if (!environment) {
      throw new Error("Auth test environment not initialized");
    }
    return environment;
  };

  const latestOtpFor = (email: string): string => {
    const normalized = email.trim().toLowerCase();
    const sent = current()
      .emailSender.sentMessages.filter((message) => message.kind === "one_time_code" && message.to.toLowerCase() === normalized)
      .at(-1);
    if (!sent || sent.kind !== "one_time_code") {
      throw new Error(`No OTP sent for ${email}`);
    }
    return sent.code;
  };

  const latestMagicLinkFor = (email: string): string => {
    const normalized = email.trim().toLowerCase();
    const sent = current()
      .emailSender.sentMessages.filter((message) => message.kind === "magic_link" && message.to.toLowerCase() === normalized)
      .at(-1);
    if (!sent || sent.kind !== "magic_link") {
      throw new Error(`No magic link sent for ${email}`);
    }
    return sent.url;
  };

  beforeAll(async () => {
    environment = await startAuthTestEnvironment();
  }, 60_000);

  afterAll(async () => {
    await environment?.stop();
  }, 30_000);

  it("enforces PostgreSQL rate limits: 3 sends/email/15m, 10 sends/IP/15m, and 20 verifies/IP/15m", async () => {
    const { app } = current();

    // 1. 3 sends per email per 15 minutes across distinct IPs
    const rateEmail = "per.email.limit@example.com";
    for (let attempt = 1; attempt <= MAX_SENDS_PER_EMAIL_PER_WINDOW; attempt += 1) {
      const okResponse = await postAuthJson(app, "/email-otp/send-verification-otp", {
        body: { email: rateEmail, type: "sign-in" },
        ipAddress: `198.51.100.${String(30 + attempt)}`,
      });
      expect(okResponse.status).toBe(200);
    }
    const fourthEmailSend = await postAuthJson(app, "/sign-in/magic-link", {
      body: { email: rateEmail, callbackURL: DEEP_LINK_CALLBACK_URL },
      ipAddress: "198.51.100.39",
    });
    expect(fourthEmailSend.status).toBe(429);

    // 2. 10 sends per IP per 15 minutes across distinct emails
    const sharedSendIp = "198.51.100.50";
    for (let count = 1; count <= MAX_SENDS_PER_IP_PER_WINDOW; count += 1) {
      const okResponse = await postAuthJson(app, "/email-otp/send-verification-otp", {
        body: { email: `ip.send.${String(count)}@example.com`, type: "sign-in" },
        ipAddress: sharedSendIp,
      });
      expect(okResponse.status).toBe(200);
    }
    const eleventhIpSend = await postAuthJson(app, "/email-otp/send-verification-otp", {
      body: { email: "ip.send.overflow@example.com", type: "sign-in" },
      ipAddress: sharedSendIp,
    });
    expect(eleventhIpSend.status).toBe(429);

    // 3. 20 verification attempts per IP per 15 minutes
    const sharedVerifyIp = "198.51.100.60";
    for (let count = 1; count <= MAX_VERIFIES_PER_IP_PER_WINDOW; count += 1) {
      const verifyAttempt = await postAuthJson(app, "/sign-in/email-otp", {
        body: { email: `verify.target.${String(count)}@example.com`, otp: "000000" },
        ipAddress: sharedVerifyIp,
      });
      expect(verifyAttempt.status).not.toBe(429);
    }
    const twentyFirstVerify = await postAuthJson(app, "/sign-in/email-otp", {
      body: { email: "verify.overflow@example.com", otp: "000000" },
      ipAddress: sharedVerifyIp,
    });
    expect(twentyFirstVerify.status).toBe(429);
  });

  it("enforces 30-day sliding session window (1-day updateAge) capped at 90 days from created_at", async () => {
    const { app, pool } = current();
    const email = "session.cap@example.com";
    const ipAddress = "198.51.100.70";

    await postAuthJson(app, "/email-otp/send-verification-otp", {
      body: { email, type: "sign-in" },
      ipAddress,
    });
    const otpCode = latestOtpFor(email);
    const signInResponse = await postAuthJson(app, "/sign-in/email-otp", {
      body: { email, otp: otpCode },
      ipAddress,
    });
    expect(signInResponse.status).toBe(200);
    const cookie = extractSessionCookie(signInResponse);
    const signInBody = (await signInResponse.json()) as { user: { id: string } };
    const userId = signInBody.user.id;

    // Move created_at to 75 days ago and updated_at to 2 days ago so sliding would exceed 90d if uncapped
    const seventyFiveDaysSeconds = 75 * 24 * 60 * 60;
    const twoDaysSeconds = 2 * 24 * 60 * 60;
    await pool.query(
      `UPDATE public.sessions
         SET created_at = now() - ($1::int * interval '1 second'),
             updated_at = now() - ($2::int * interval '1 second'),
             expires_at = now() + (10 * 86400 * interval '1 second')
         WHERE user_id = $3`,
      [seventyFiveDaysSeconds, twoDaysSeconds, userId],
    );

    const refreshedResponse = await getAuthPath(app, "/get-session", { cookie, ipAddress });
    expect(refreshedResponse.status).toBe(200);

    const cappedCheck = await pool.query<{ lifetime_seconds: number }>(
      "SELECT extract(epoch FROM expires_at - created_at)::int AS lifetime_seconds FROM public.sessions WHERE user_id = $1",
      [userId],
    );
    expect(cappedCheck.rows[0]?.lifetime_seconds).toBeLessThanOrEqual(SESSION_ABSOLUTE_MAX_LIFETIME_SECONDS + 5);

    // Move created_at past 90 days: session must now be rejected and deleted
    const ninetyOneDaysSeconds = 91 * 24 * 60 * 60;
    await pool.query(
      `UPDATE public.sessions
         SET created_at = now() - ($1::int * interval '1 second')
         WHERE user_id = $2`,
      [ninetyOneDaysSeconds, userId],
    );

    const expiredByCapResponse = await getAuthPath(app, "/get-session", { cookie, ipAddress });
    const expiredPayload: unknown = await expiredByCapResponse.json();
    expect(expiredPayload).toBeNull();
  });

  it("enforces RLS under bjj_app and emits zero PII or secrets in logs across auth flows", async () => {
    const { app, database, codec } = current();
    const capturedLogs: string[] = [];
    const recordLog = (...entries: unknown[]) => {
      capturedLogs.push(entries.map((entry) => String(entry)).join(" "));
    };

    const logSpy = vi.spyOn(console, "log").mockImplementation(recordLog);
    const infoSpy = vi.spyOn(console, "info").mockImplementation(recordLog);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(recordLog);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(recordLog);

    const emailAlpha = "noleak.alpha@example.com";
    const emailBravo = "noleak.bravo@example.com";
    const ipAddress = "198.51.100.80";

    try {
      // Run OTP flow for Alpha
      await postAuthJson(app, "/email-otp/send-verification-otp", {
        body: { email: emailAlpha, type: "sign-in" },
        ipAddress,
      });
      const otpAlpha = latestOtpFor(emailAlpha);
      const signInAlpha = await postAuthJson(app, "/sign-in/email-otp", {
        body: { email: emailAlpha, otp: otpAlpha },
        ipAddress,
      });
      const alphaPayload = (await signInAlpha.json()) as {
        token: string;
        user: { id: string };
      };

      // Run Magic Link + Exchange flow for Bravo
      await postAuthJson(app, "/sign-in/magic-link", {
        body: { email: emailBravo, callbackURL: DEEP_LINK_CALLBACK_URL },
        ipAddress,
      });
      const magicUrlBravo = latestMagicLinkFor(emailBravo);
      const rawMagicToken = new URL(magicUrlBravo).searchParams.get("token") ?? "";
      const verifyBravo = await getAuthPath(app, magicUrlBravo, { ipAddress });
      const exchangeCodeBravo = new URL(verifyBravo.headers.get("location") ?? "").searchParams.get("code") ?? "";
      const exchangeBravo = await postAuthJson(app, "/magic-link/exchange", {
        body: { code: exchangeCodeBravo },
        ipAddress,
      });
      const bravoPayload = (await exchangeBravo.json()) as {
        token: string;
        user: { id: string };
      };

      // Trigger failure paths too
      await postAuthJson(app, "/sign-in/email-otp", {
        body: { email: emailAlpha, otp: "999999" },
        ipAddress,
      });
      await postAuthJson(app, "/magic-link/exchange", {
        body: { code: exchangeCodeBravo },
        ipAddress,
      });

      // Verify RLS isolation as bjj_app
      await withAppRoleUnscoped(database.db, async (transaction) => {
        const visibleUsers = await transaction.selectFrom("users").selectAll().execute();
        expect(visibleUsers).toHaveLength(0);
      });

      await withUserContext(database.db, alphaPayload.user.id, async (transaction) => {
        const visibleUsers = await transaction.selectFrom("users").select(["id"]).execute();
        expect(visibleUsers).toEqual([{ id: alphaPayload.user.id }]);
      });

      const combinedLogs = capturedLogs.join("\n").toLowerCase();
      expect(combinedLogs).not.toContain(emailAlpha);
      expect(combinedLogs).not.toContain(emailBravo);
      expect(combinedLogs).not.toContain(otpAlpha.toLowerCase());
      expect(combinedLogs).not.toContain(rawMagicToken.toLowerCase());
      expect(combinedLogs).not.toContain(exchangeCodeBravo.toLowerCase());
      expect(combinedLogs).not.toContain(alphaPayload.token.toLowerCase());
      expect(combinedLogs).not.toContain(bravoPayload.token.toLowerCase());
      expect(combinedLogs).not.toContain(codec.computeEmailHmac(emailAlpha));
    } finally {
      logSpy.mockRestore();
      infoSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
