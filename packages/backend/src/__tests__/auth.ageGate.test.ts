import { AGE_GATE_REFUSAL_MESSAGE } from "@bjj-roll/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DEEP_LINK_CALLBACK_URL } from "../auth/index.js";
import { isPostgresTestEnvironmentAvailable } from "./databaseTestHarness.js";
import {
  dumpRawAuthTables,
  extractSessionCookie,
  getAuthPath,
  postAuthJson,
  startAuthTestEnvironment,
  type StartedAuthTestEnvironment,
} from "./authTestHelper.js";

const otpSendPath = "/email-otp/send-verification-otp";
const magicLinkSendPath = "/sign-in/magic-link";
const ageColumnPattern = "(^|_)age($|_)|age_?confirm|birth|dob|adult|minor";

describe.skipIf(!isPostgresTestEnvironmentAvailable())("HEN-77 age gate on account creation", () => {
  let environment: StartedAuthTestEnvironment | undefined;
  const capturedLogs: string[] = [];

  const current = (): StartedAuthTestEnvironment => {
    if (!environment) {
      throw new Error("Auth test environment not initialized");
    }
    return environment;
  };

  const latestOtpFor = (email: string): string => {
    const sent = current()
      .emailSender.sentMessages.filter((message) => message.kind === "one_time_code" && message.to.toLowerCase() === email.toLowerCase())
      .at(-1);
    if (!sent || sent.kind !== "one_time_code") {
      throw new Error(`No OTP sent for ${email}`);
    }
    return sent.code;
  };

  const latestMagicLinkFor = (email: string): string => {
    const sent = current()
      .emailSender.sentMessages.filter((message) => message.kind === "magic_link" && message.to.toLowerCase() === email.toLowerCase())
      .at(-1);
    if (!sent || sent.kind !== "magic_link") {
      throw new Error(`No magic link sent for ${email}`);
    }
    return sent.url;
  };

  const countRows = async (table: "users" | "sessions" | "verifications"): Promise<number> => {
    const result = await current().pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM public.${table}`);
    return result.rows[0]?.count ?? 0;
  };

  const countEmailRateLimitRows = async (email: string): Promise<number> => {
    const { pool, codec } = current();
    const result = await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM public.rate_limits WHERE key = $1", [
      `email:${codec.computeEmailHmac(email)}`,
    ]);
    return result.rows[0]?.count ?? 0;
  };

  const signUpWithOtp = async (email: string, ipAddress: string): Promise<{ userId: string; cookie: string }> => {
    const sendResponse = await postAuthJson(current().app, otpSendPath, { body: { email, type: "sign-in", ageConfirmed: true }, ipAddress });
    expect(sendResponse.status).toBe(200);
    const signInResponse = await postAuthJson(current().app, "/sign-in/email-otp", { body: { email, otp: latestOtpFor(email) }, ipAddress });
    expect(signInResponse.status).toBe(200);
    const payload = (await signInResponse.json()) as { user: { id: string } };
    return { userId: payload.user.id, cookie: extractSessionCookie(signInResponse) };
  };

  beforeAll(async () => {
    const recordLog = (...entries: unknown[]): void => {
      capturedLogs.push(entries.map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry))).join(" "));
    };
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation(recordLog);
    }
    environment = await startAuthTestEnvironment({ logger: { disabled: false, level: "debug" } });
  }, 60_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await environment?.stop();
  }, 30_000);

  it.each([
    { name: "OTP send without ageConfirmed", path: otpSendPath, body: { email: "no.flag.otp@example.com", type: "sign-in" } },
    {
      name: "OTP send with ageConfirmed false",
      path: otpSendPath,
      body: { email: "false.flag.otp@example.com", type: "sign-in", ageConfirmed: false },
    },
    {
      name: "OTP send with ageConfirmed as a string",
      path: otpSendPath,
      body: { email: "string.flag.otp@example.com", type: "sign-in", ageConfirmed: "true" },
    },
    {
      name: "magic link without ageConfirmed",
      path: magicLinkSendPath,
      body: { email: "no.flag.link@example.com", callbackURL: DEEP_LINK_CALLBACK_URL },
    },
    {
      name: "magic link with ageConfirmed false",
      path: magicLinkSendPath,
      body: { email: "false.flag.link@example.com", callbackURL: DEEP_LINK_CALLBACK_URL, ageConfirmed: false },
    },
  ])("AC 1 & 4: refuses $name with 400 and leaves no user, session, OTP, email or per-email counter", async ({ path, body }) => {
    const { app, emailSender } = current();
    const before = { users: await countRows("users"), sessions: await countRows("sessions"), verifications: await countRows("verifications") };
    const sentBefore = emailSender.sentMessages.length;

    const response = await postAuthJson(app, path, { body, ipAddress: "198.51.100.170" });

    expect(response.status).toBe(400);
    expect(((await response.json()) as { message?: string }).message).toBe(AGE_GATE_REFUSAL_MESSAGE);
    expect(extractSessionCookie(response)).toBe("");
    expect(await countRows("users")).toBe(before.users);
    expect(await countRows("sessions")).toBe(before.sessions);
    expect(await countRows("verifications")).toBe(before.verifications);
    expect(emailSender.sentMessages.length).toBe(sentBefore);
    expect(await countEmailRateLimitRows(body.email)).toBe(0);
  });

  it("AC 1: an OTP for a refused email cannot be used to create the account", async () => {
    const { app } = current();
    const email = "refused.then.guess@example.com";
    await postAuthJson(app, otpSendPath, { body: { email, type: "sign-in" }, ipAddress: "198.51.100.171" });
    const usersBefore = await countRows("users");
    const signInResponse = await postAuthJson(app, "/sign-in/email-otp", { body: { email, otp: "123456" }, ipAddress: "198.51.100.171" });
    expect(signInResponse.status).toBe(400);
    expect(await countRows("users")).toBe(usersBefore);
  });

  it("AC 4: repeated refusals never lock out the email; a later confirmed sign-up succeeds", async () => {
    const { app } = current();
    const email = "refused.often@example.com";
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const refused = await postAuthJson(app, otpSendPath, { body: { email, type: "sign-in" }, ipAddress: "198.51.100.172" });
      expect(refused.status).toBe(400);
    }
    expect(await countEmailRateLimitRows(email)).toBe(0);
    const { userId } = await signUpWithOtp(email, "198.51.100.173");
    expect(userId).toBeTruthy();
  });

  it("AC 2: account creation with ageConfirmed true succeeds over OTP and magic link", async () => {
    const { app } = current();
    const usersBefore = await countRows("users");
    const { userId, cookie } = await signUpWithOtp("confirmed.otp@example.com", "198.51.100.174");
    expect(userId).toBeTruthy();
    expect(cookie).toContain("=");

    const linkEmail = "confirmed.link@example.com";
    const sendResponse = await postAuthJson(app, magicLinkSendPath, {
      body: { email: linkEmail, callbackURL: DEEP_LINK_CALLBACK_URL, ageConfirmed: true },
      ipAddress: "198.51.100.175",
    });
    expect(sendResponse.status).toBe(200);
    const verifyResponse = await getAuthPath(app, latestMagicLinkFor(linkEmail), { ipAddress: "198.51.100.175" });
    const exchangeCode = new URL(verifyResponse.headers.get("location") ?? "").searchParams.get("code") ?? "";
    const exchangeResponse = await postAuthJson(app, "/magic-link/exchange", { body: { code: exchangeCode }, ipAddress: "198.51.100.175" });
    expect(exchangeResponse.status).toBe(200);
    expect(await countRows("users")).toBe(usersBefore + 2);
  });

  it("AC 5: an existing user signs in again without sending ageConfirmed", async () => {
    const { app } = current();
    const email = "returning.member@example.com";
    const { userId } = await signUpWithOtp(email, "198.51.100.176");

    const sendResponse = await postAuthJson(app, otpSendPath, { body: { email, type: "sign-in" }, ipAddress: "198.51.100.177" });
    expect(sendResponse.status).toBe(200);
    const signInResponse = await postAuthJson(app, "/sign-in/email-otp", { body: { email, otp: latestOtpFor(email) }, ipAddress: "198.51.100.177" });
    expect(signInResponse.status).toBe(200);
    expect(((await signInResponse.json()) as { user: { id: string } }).user.id).toBe(userId);

    const linkResponse = await postAuthJson(app, magicLinkSendPath, {
      body: { email, callbackURL: DEEP_LINK_CALLBACK_URL },
      ipAddress: "198.51.100.177",
    });
    expect(linkResponse.status).toBe(200);
  });

  it("AC 3: no table or column holds an age answer, and no stored row mentions it", async () => {
    const { pool } = current();
    const columns = await pool.query<{ table_name: string; column_name: string }>(
      "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND (column_name ~* $1 OR table_name ~* $1)",
      [ageColumnPattern],
    );
    expect(columns.rows).toEqual([]);
    const rawDump = (await dumpRawAuthTables(pool)).toLowerCase();
    expect(rawDump).not.toContain("ageconfirmed");
    expect(rawDump).not.toContain("age_confirmed");
  });

  it("AC 3 & 4: logs carry no age answer, refusal or email, for confirmed and refused attempts", () => {
    expect(capturedLogs.length).toBeGreaterThan(0);
    const allLogs = capturedLogs.join("\n").toLowerCase();
    expect(allLogs).not.toContain("ageconfirmed");
    expect(allLogs).not.toContain(AGE_GATE_REFUSAL_MESSAGE.toLowerCase());
    for (const email of [
      "no.flag.otp@example.com",
      "false.flag.link@example.com",
      "refused.often@example.com",
      "confirmed.otp@example.com",
      "returning.member@example.com",
    ]) {
      expect(allLogs).not.toContain(email);
    }
  });
});
