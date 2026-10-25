import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { OTP_EXPIRY_SECONDS, OTP_MAX_ATTEMPTS, SESSION_SLIDING_EXPIRY_SECONDS } from "../auth/index.js";
import { isPostgresTestEnvironmentAvailable } from "./databaseTestHarness.js";
import {
  dumpRawAuthTables,
  extractSessionCookie,
  getAuthPath,
  postAuthJson,
  startAuthTestEnvironment,
  type StartedAuthTestEnvironment,
} from "./authTestHelper.js";

describe.skipIf(!isPostgresTestEnvironmentAvailable())("HEN-71 Better Auth email OTP flow", () => {
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

  beforeAll(async () => {
    environment = await startAuthTestEnvironment();
  }, 60_000);

  afterAll(async () => {
    await environment?.stop();
  }, 30_000);

  it("sends a 6-digit OTP, signs in, creates a session, and stores only encrypted/hashed values at rest", async () => {
    const { app, pool, codec } = current();
    const email = "Otp.User@Example.com";
    const ipAddress = "198.51.100.11";

    const sendResponse = await postAuthJson(app, "/email-otp/send-verification-otp", {
      body: { email, type: "sign-in" },
      ipAddress,
    });
    expect(sendResponse.status).toBe(200);

    const otpCode = latestOtpFor(email);
    expect(otpCode).toMatch(/^\d{6}$/);

    // Verify stored OTP row has 10-minute expiry and keyed HMAC hash at rest
    const expectedIdentifier = `sign-in-otp-${codec.computeEmailHmac(email)}`;
    const verificationRow = await pool.query<{ value: string; lifetime: number }>(
      "SELECT value, extract(epoch FROM expires_at - created_at)::int AS lifetime FROM public.verifications WHERE identifier = $1",
      [expectedIdentifier],
    );
    expect(verificationRow.rowCount).toBe(1);
    expect(verificationRow.rows[0]?.value).not.toContain(otpCode);
    expect(codec.decryptVerificationPayload(verificationRow.rows[0]?.value ?? "")).toBe(`${codec.hashOtpCode(otpCode)}:0`);
    expect(Math.abs((verificationRow.rows[0]?.lifetime ?? 0) - OTP_EXPIRY_SECONDS)).toBeLessThanOrEqual(5);

    const signInResponse = await postAuthJson(app, "/sign-in/email-otp", {
      body: { email, otp: otpCode },
      ipAddress,
    });
    expect(signInResponse.status).toBe(200);
    const signInPayload = (await signInResponse.json()) as {
      token: string;
      user: { id: string; email: string; emailVerified: boolean };
    };
    expect(signInPayload.token).toBeTruthy();
    expect(signInPayload.user.email).toBe("otp.user@example.com");
    expect(signInPayload.user.emailVerified).toBe(true);

    // Pre-session lookup function resolves the created user by email_hash
    const lookupRow = await pool.query<{ user_id: string | null }>("SELECT public.app_user_id_by_email_hmac($1) AS user_id", [
      codec.computeEmailHmac(email),
    ]);
    expect(lookupRow.rows[0]?.user_id).toBe(signInPayload.user.id);

    const cookie = extractSessionCookie(signInResponse);
    expect(cookie).toContain("=");
    const sessionResponse = await getAuthPath(app, "/get-session", { cookie, ipAddress });
    expect(sessionResponse.status).toBe(200);
    const sessionPayload = (await sessionResponse.json()) as {
      session: { userId: string; expiresAt: string };
      user: { id: string; email: string };
    };
    expect(sessionPayload.session.userId).toBe(signInPayload.user.id);
    expect(sessionPayload.user.email).toBe("otp.user@example.com");
    const expiresDelta = (Date.parse(sessionPayload.session.expiresAt) - Date.now()) / 1000;
    expect(Math.abs(expiresDelta - SESSION_SLIDING_EXPIRY_SECONDS)).toBeLessThan(60);

    // Raw database dump never contains plaintext email or OTP code
    const rawDump = await dumpRawAuthTables(pool);
    expect(rawDump.toLowerCase()).not.toContain("otp.user@example.com");
    expect(rawDump).not.toContain(otpCode);
  });

  it("AC 7 (fake clock): OTP accepted 1 second before 10 minutes, rejected 1 second after", async () => {
    const { app } = current();
    const ipAddress = "198.51.100.12";
    const startMs = Date.parse("2026-03-01T10:00:00.000Z");
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(startMs);
      await postAuthJson(app, "/email-otp/send-verification-otp", { body: { email: "expired.otp@example.com", type: "sign-in" }, ipAddress });
      const expiredCode = latestOtpFor("expired.otp@example.com");
      vi.setSystemTime(startMs + OTP_EXPIRY_SECONDS * 1000 + 1000);
      const expiredResponse = await postAuthJson(app, "/sign-in/email-otp", {
        body: { email: "expired.otp@example.com", otp: expiredCode },
        ipAddress,
      });
      expect(expiredResponse.status).toBe(400);
      expect(extractSessionCookie(expiredResponse)).toBe("");

      const secondStartMs = startMs + 60 * 60 * 1000;
      vi.setSystemTime(secondStartMs);
      await postAuthJson(app, "/email-otp/send-verification-otp", { body: { email: "ontime.otp@example.com", type: "sign-in" }, ipAddress });
      const onTimeCode = latestOtpFor("ontime.otp@example.com");
      vi.setSystemTime(secondStartMs + OTP_EXPIRY_SECONDS * 1000 - 1000);
      const onTimeResponse = await postAuthJson(app, "/sign-in/email-otp", { body: { email: "ontime.otp@example.com", otp: onTimeCode }, ipAddress });
      expect(onTimeResponse.status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it("AC 5: a used OTP cannot be used again", async () => {
    const { app } = current();
    const email = "reuse.otp@example.com";
    const ipAddress = "198.51.100.14";
    await postAuthJson(app, "/email-otp/send-verification-otp", { body: { email, type: "sign-in" }, ipAddress });
    const otpCode = latestOtpFor(email);

    const firstUse = await postAuthJson(app, "/sign-in/email-otp", { body: { email, otp: otpCode }, ipAddress });
    expect(firstUse.status).toBe(200);
    expect(extractSessionCookie(firstUse)).toContain("=");

    const secondUse = await postAuthJson(app, "/sign-in/email-otp", { body: { email, otp: otpCode }, ipAddress });
    expect(secondUse.status).toBe(400);
    expect(extractSessionCookie(secondUse)).toBe("");
  });

  it("invalidates the OTP after 5 wrong verification attempts and requires a new code", async () => {
    const { app } = current();
    const email = "attempts.otp@example.com";
    const ipAddress = "198.51.100.13";

    await postAuthJson(app, "/email-otp/send-verification-otp", {
      body: { email, type: "sign-in" },
      ipAddress,
    });
    const otpCode = latestOtpFor(email);
    const wrongOtp = otpCode === "000000" ? "111111" : "000000";

    for (let attempt = 0; attempt < OTP_MAX_ATTEMPTS; attempt += 1) {
      const badResponse = await postAuthJson(app, "/sign-in/email-otp", {
        body: { email, otp: wrongOtp },
        ipAddress,
      });
      expect(badResponse.status).toBeGreaterThanOrEqual(400);
    }

    // Even the right code is now rejected because max attempts (5) was reached
    const afterBurnResponse = await postAuthJson(app, "/sign-in/email-otp", {
      body: { email, otp: otpCode },
      ipAddress,
    });
    expect(afterBurnResponse.status).toBeGreaterThanOrEqual(400);
  });
});
