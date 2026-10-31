import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  DEEP_LINK_CALLBACK_URL,
  MAX_SENDS_PER_EMAIL_PER_WINDOW,
  MAX_SENDS_PER_IP_PER_WINDOW,
  MAX_VERIFIES_PER_IP_PER_WINDOW,
} from "../auth/index.js";
import { withAppRoleUnscoped, withUserContext } from "../database/index.js";
import { isPostgresTestEnvironmentAvailable } from "./databaseTestHarness.js";
import { getAuthPath, postAuthJson, startAuthTestEnvironment, type StartedAuthTestEnvironment, currentSignUpAttestation } from "./authTestHelper.js";

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
    environment = await startAuthTestEnvironment({ logger: { disabled: false, level: "debug" } });
  }, 60_000);

  afterAll(async () => {
    await environment?.stop();
  }, 30_000);

  it("rate_limits comes from migration 002 (no runtime DDL) and auth connects as a NOBYPASSRLS login in bjj_app", async () => {
    const { pool, appLogin } = current();
    const table = await pool.query<{ tableowner: string; rowsecurity: boolean }>(
      "SELECT tableowner, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'rate_limits'",
    );
    expect(table.rows).toEqual([{ tableowner: "bjj_owner", rowsecurity: true }]);

    const role = await pool.query<{ rolsuper: boolean; rolbypassrls: boolean; member_of_app: boolean }>(
      "SELECT rolsuper, rolbypassrls, pg_has_role(rolname, 'bjj_app', 'MEMBER') AS member_of_app FROM pg_roles WHERE rolname = $1",
      [appLogin.roleName],
    );
    expect(role.rows).toEqual([{ rolsuper: false, rolbypassrls: false, member_of_app: true }]);

    const loginCannotCreate = appLogin.pool.query("CREATE TABLE public.should_not_exist (id int)");
    await expect(loginCannotCreate).rejects.toThrow();
  });

  it("proxy headers are ignored by default: rotating X-Forwarded-For from one socket still hits 429 after 10 sends", async () => {
    const { app, emailSender } = current();
    const socketIp = "198.51.100.90";
    const statuses: number[] = [];
    for (let count = 1; count <= 15; count += 1) {
      const sentBefore = emailSender.sentMessages.length;
      const response = await postAuthJson(app, "/email-otp/send-verification-otp", {
        body: { email: `xff.rotate.${String(count)}@example.com`, type: "sign-in", age16Confirmed: true, ...currentSignUpAttestation },
        ipAddress: socketIp,
        headers: {
          "x-forwarded-for": `203.0.113.${String(count)}`,
          "x-real-ip": `203.0.113.${String(count)}`,
          "cf-connecting-ip": `203.0.113.${String(count)}`,
        },
      });
      statuses.push(response.status);
      if (response.status === 429) {
        expect(emailSender.sentMessages.length).toBe(sentBefore);
      }
    }
    expect(statuses).toEqual([...Array<number>(MAX_SENDS_PER_IP_PER_WINDOW).fill(200), ...Array<number>(15 - MAX_SENDS_PER_IP_PER_WINDOW).fill(429)]);
  });

  it("enforces PostgreSQL rate limits: 3 sends/email/15m, 10 sends/IP/15m, and 20 verifies/IP/15m", async () => {
    const { app } = current();

    const rateEmail = "per.email.limit@example.com";
    for (let attempt = 1; attempt <= MAX_SENDS_PER_EMAIL_PER_WINDOW; attempt += 1) {
      const okResponse = await postAuthJson(app, "/email-otp/send-verification-otp", {
        body: { email: rateEmail, type: "sign-in", age16Confirmed: true, ...currentSignUpAttestation },
        ipAddress: `198.51.100.${String(30 + attempt)}`,
      });
      expect(okResponse.status).toBe(200);
    }
    const sentBeforeEmailOverflow = current().emailSender.sentMessages.length;
    const fourthEmailSend = await postAuthJson(app, "/sign-in/magic-link", {
      body: { email: rateEmail, callbackURL: DEEP_LINK_CALLBACK_URL, age16Confirmed: true, ...currentSignUpAttestation },
      ipAddress: "198.51.100.39",
    });
    expect(fourthEmailSend.status).toBe(429);
    expect(current().emailSender.sentMessages.length).toBe(sentBeforeEmailOverflow);

    const sharedSendIp = "198.51.100.50";
    for (let count = 1; count <= MAX_SENDS_PER_IP_PER_WINDOW; count += 1) {
      const okResponse = await postAuthJson(app, "/email-otp/send-verification-otp", {
        body: { email: `ip.send.${String(count)}@example.com`, type: "sign-in", age16Confirmed: true, ...currentSignUpAttestation },
        ipAddress: sharedSendIp,
      });
      expect(okResponse.status).toBe(200);
    }
    const sentBeforeIpOverflow = current().emailSender.sentMessages.length;
    const eleventhIpSend = await postAuthJson(app, "/email-otp/send-verification-otp", {
      body: { email: "ip.send.overflow@example.com", type: "sign-in", age16Confirmed: true, ...currentSignUpAttestation },
      ipAddress: sharedSendIp,
    });
    expect(eleventhIpSend.status).toBe(429);
    expect(current().emailSender.sentMessages.length).toBe(sentBeforeIpOverflow);

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
      await postAuthJson(app, "/email-otp/send-verification-otp", {
        body: { email: emailAlpha, type: "sign-in", age16Confirmed: true, ...currentSignUpAttestation },
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

      await postAuthJson(app, "/sign-in/magic-link", {
        body: { email: emailBravo, callbackURL: DEEP_LINK_CALLBACK_URL, age16Confirmed: true, ...currentSignUpAttestation },
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

      await postAuthJson(app, "/sign-in/email-otp", {
        body: { email: emailAlpha, otp: "999999" },
        ipAddress,
      });
      await postAuthJson(app, "/magic-link/exchange", {
        body: { code: exchangeCodeBravo },
        ipAddress,
      });

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
