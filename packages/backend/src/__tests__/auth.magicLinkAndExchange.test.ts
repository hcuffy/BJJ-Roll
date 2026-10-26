import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DEEP_LINK_CALLBACK_URL, MAGIC_LINK_EXCHANGE_CODE_EXPIRY_SECONDS, MAGIC_LINK_EXPIRY_SECONDS } from "../auth/index.js";
import { isPostgresTestEnvironmentAvailable } from "./databaseTestHarness.js";
import {
  dumpRawAuthTables,
  extractSessionCookie,
  getAuthPath,
  postAuthJson,
  startAuthTestEnvironment,
  type StartedAuthTestEnvironment,
} from "./authTestHelper.js";

describe.skipIf(!isPostgresTestEnvironmentAvailable())("HEN-71 Better Auth magic link & deep-link exchange code flow", () => {
  let environment: StartedAuthTestEnvironment | undefined;

  const current = (): StartedAuthTestEnvironment => {
    if (!environment) {
      throw new Error("Auth test environment not initialized");
    }
    return environment;
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

  it("stores hashed magic-link token (15m), redirects to bjjroll:// with 60s exchange code only, and exchanges for session", async () => {
    const { app, pool, codec } = current();
    const email = "Magic.User@Example.com";
    const ipAddress = "198.51.100.21";

    const sendResponse = await postAuthJson(app, "/sign-in/magic-link", {
      body: { email, callbackURL: DEEP_LINK_CALLBACK_URL, age16Confirmed: true },
      ipAddress,
    });
    expect(sendResponse.status).toBe(200);

    const magicLinkUrl = latestMagicLinkFor(email);
    const parsedMagicUrl = new URL(magicLinkUrl);
    const rawToken = parsedMagicUrl.searchParams.get("token") ?? "";
    expect(rawToken.length).toBeGreaterThan(10);

    // Verify magic-link token is hashed at rest with 15-minute expiry
    const hashedToken = `magic-link:${codec.hashMagicLinkToken(rawToken)}`;
    const storedMagicRow = await pool.query<{ value: string; lifetime: number }>(
      "SELECT value, extract(epoch FROM expires_at - created_at)::int AS lifetime FROM public.verifications WHERE identifier = $1",
      [hashedToken],
    );
    expect(storedMagicRow.rowCount).toBe(1);
    expect(Math.abs((storedMagicRow.rows[0]?.lifetime ?? 0) - MAGIC_LINK_EXPIRY_SECONDS)).toBeLessThanOrEqual(5);

    // Verify magic link: returns 302 to bjjroll://auth/callback?code=<exchange_code> ONLY
    const verifyResponse = await getAuthPath(app, magicLinkUrl, { ipAddress });
    expect(verifyResponse.status).toBe(302);
    expect(verifyResponse.headers.get("set-cookie")).toBeNull();

    const location = verifyResponse.headers.get("location") ?? "";
    expect(location.startsWith(`${DEEP_LINK_CALLBACK_URL}?`)).toBe(true);
    const redirectUrl = new URL(location);
    expect([...redirectUrl.searchParams.keys()]).toEqual(["code"]);
    const exchangeCode = redirectUrl.searchParams.get("code") ?? "";
    expect(exchangeCode.length).toBeGreaterThan(16);
    expect(location).not.toContain(rawToken);

    // Verify magic-link token was single-use (replaying verify fails)
    const replayVerify = await getAuthPath(app, magicLinkUrl, { ipAddress });
    expect(replayVerify.headers.get("location") ?? "").not.toContain("code=");

    // Verify exchange code is stored hashed at rest with 60-second expiry
    const hashedExchangeIdentifier = `magic-link-exchange:${codec.hashExchangeCode(exchangeCode)}`;
    const storedExchangeRow = await pool.query<{ lifetime: number }>(
      "SELECT extract(epoch FROM expires_at - created_at)::int AS lifetime FROM public.verifications WHERE identifier = $1",
      [hashedExchangeIdentifier],
    );
    expect(storedExchangeRow.rowCount).toBe(1);
    expect(Math.abs((storedExchangeRow.rows[0]?.lifetime ?? 0) - MAGIC_LINK_EXCHANGE_CODE_EXPIRY_SECONDS)).toBeLessThanOrEqual(5);

    // Raw DB dump never contains plaintext email, raw magic-link token, or raw exchange code
    const rawDumpBeforeExchange = await dumpRawAuthTables(pool);
    expect(rawDumpBeforeExchange.toLowerCase()).not.toContain("magic.user@example.com");
    expect(rawDumpBeforeExchange).not.toContain(rawToken);
    expect(rawDumpBeforeExchange).not.toContain(exchangeCode);

    // Trade one-time exchange code over HTTPS for a session
    const exchangeResponse = await postAuthJson(app, "/magic-link/exchange", {
      body: { code: exchangeCode },
      ipAddress,
    });
    expect(exchangeResponse.status).toBe(200);
    const exchangePayload = (await exchangeResponse.json()) as {
      token: string;
      session: { userId: string; expiresAt: string };
      user: { id: string; email: string; emailVerified: boolean };
    };
    expect(exchangePayload.token).toBeTruthy();
    expect(exchangePayload.user.email).toBe("magic.user@example.com");
    expect(exchangePayload.user.emailVerified).toBe(true);
    expect(location).not.toContain(exchangePayload.token);

    // Cookie issued by exchange route authenticates /get-session
    const sessionCookie = extractSessionCookie(exchangeResponse);
    expect(sessionCookie).toContain("=");
    const getSessionResponse = await getAuthPath(app, "/get-session", {
      cookie: sessionCookie,
      ipAddress,
    });
    expect(getSessionResponse.status).toBe(200);

    // Exchange code is single-use: second exchange attempt returns 401
    const secondExchange = await postAuthJson(app, "/magic-link/exchange", {
      body: { code: exchangeCode },
      ipAddress,
    });
    expect(secondExchange.status).toBe(401);
  });

  it("AC 7 (fake clock): magic link valid 15 minutes, exchange code valid 60 seconds", async () => {
    const { app } = current();
    const ipAddress = "198.51.100.22";
    const startMs = Date.parse("2026-03-01T10:00:00.000Z");
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      // Magic link used 1 second after 15 minutes: rejected, no exchange code.
      vi.setSystemTime(startMs);
      await postAuthJson(app, "/sign-in/magic-link", { body: { email: "expired.magic.one@example.com", age16Confirmed: true }, ipAddress });
      const expiredLink = latestMagicLinkFor("expired.magic.one@example.com");
      vi.setSystemTime(startMs + MAGIC_LINK_EXPIRY_SECONDS * 1000 + 1000);
      const expiredVerify = await getAuthPath(app, expiredLink, { ipAddress });
      expect(expiredVerify.status).toBe(400);
      expect(expiredVerify.headers.get("location") ?? "").not.toContain("code=");

      // Magic link used 1 second before 15 minutes: accepted.
      const secondStartMs = startMs + 60 * 60 * 1000;
      vi.setSystemTime(secondStartMs);
      await postAuthJson(app, "/sign-in/magic-link", { body: { email: "expired.magic.two@example.com", age16Confirmed: true }, ipAddress });
      const validLink = latestMagicLinkFor("expired.magic.two@example.com");
      vi.setSystemTime(secondStartMs + MAGIC_LINK_EXPIRY_SECONDS * 1000 - 1000);
      const validVerify = await getAuthPath(app, validLink, { ipAddress });
      expect(validVerify.status).toBe(302);
      const lateCode = new URL(validVerify.headers.get("location") ?? "").searchParams.get("code") ?? "";
      expect(lateCode.length).toBeGreaterThan(16);

      // Exchange code used 1 second after 60 seconds: rejected, and the row is gone (single use even when expired).
      vi.setSystemTime(Date.now() + MAGIC_LINK_EXCHANGE_CODE_EXPIRY_SECONDS * 1000 + 1000);
      const expiredExchange = await postAuthJson(app, "/magic-link/exchange", { body: { code: lateCode }, ipAddress });
      expect(expiredExchange.status).toBe(401);
      expect(extractSessionCookie(expiredExchange)).toBe("");

      // A fresh code used at 59 seconds: accepted.
      await postAuthJson(app, "/sign-in/magic-link", { body: { email: "expired.magic.two@example.com", age16Confirmed: true }, ipAddress });
      const thirdLink = latestMagicLinkFor("expired.magic.two@example.com");
      const thirdVerify = await getAuthPath(app, thirdLink, { ipAddress });
      const onTimeCode = new URL(thirdVerify.headers.get("location") ?? "").searchParams.get("code") ?? "";
      vi.setSystemTime(Date.now() + (MAGIC_LINK_EXCHANGE_CODE_EXPIRY_SECONDS - 1) * 1000);
      const onTimeExchange = await postAuthJson(app, "/magic-link/exchange", { body: { code: onTimeCode }, ipAddress });
      expect(onTimeExchange.status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it("AC 7: the /exchange-code alias is gone", async () => {
    const { app } = current();
    const response = await postAuthJson(app, "/exchange-code", { body: { code: "anything" }, ipAddress: "198.51.100.24" });
    expect(response.status).toBe(404);
  });

  const hostileRedirects = [
    "https://evil.example.com/steal",
    "//evil.example.com",
    "javascript:alert(1)",
    "https%3A%2F%2Fevil.example.com",
    "bjjroll://@evil.example.com",
    "bjjroll://evil.example.com/callback",
    "bjjroll://user:pass@auth/callback",
    " bjjroll://auth/callback",
    "bjjroll://auth.evil.example.com/callback",
  ];
  const redirectParameters = ["callbackURL", "newUserCallbackURL", "errorCallbackURL"] as const;

  it("open redirect: POST /sign-in/magic-link rejects every non-bjjroll redirect parameter with 400 and sends no email", async () => {
    const { app, emailSender } = current();
    let requestIndex = 0;
    for (const parameter of redirectParameters) {
      for (const hostile of hostileRedirects) {
        requestIndex += 1;
        const sentBefore = emailSender.sentMessages.length;
        const response = await postAuthJson(app, "/sign-in/magic-link", {
          body: {
            email: `redirect.post.${String(requestIndex)}@example.com`,
            callbackURL: DEEP_LINK_CALLBACK_URL,
            [parameter]: hostile,
            age16Confirmed: true,
          },
          ipAddress: `198.51.101.${String(requestIndex)}`,
        });
        expect({ parameter, hostile, status: response.status }).toEqual({ parameter, hostile, status: 400 });
        expect(response.headers.get("location")).toBeNull();
        expect(((await response.json()) as { code: string }).code).toBe("INVALID_CALLBACK_URL");
        expect(emailSender.sentMessages.length).toBe(sentBefore);
      }
    }
  });

  it("open redirect: GET /magic-link/verify rejects every non-bjjroll redirect parameter with 400, never 302, and keeps the token", async () => {
    const { app } = current();
    const email = "redirect.verify@example.com";
    await postAuthJson(app, "/sign-in/magic-link", { body: { email, age16Confirmed: true }, ipAddress: "198.51.102.1" });
    const magicLink = new URL(latestMagicLinkFor(email));
    let requestIndex = 0;
    for (const parameter of redirectParameters) {
      for (const hostile of hostileRedirects) {
        requestIndex += 1;
        const url = new URL(magicLink);
        url.searchParams.set(parameter, hostile);
        const response = await getAuthPath(app, url.toString(), { ipAddress: `198.51.102.${String(requestIndex + 1)}` });
        expect({ parameter, hostile, status: response.status }).toEqual({ parameter, hostile, status: 400 });
        expect(response.headers.get("location")).toBeNull();
      }
    }

    // A bad token with a hostile errorCallbackURL: still 400, no redirect to the error URL.
    const badToken = await getAuthPath(app, "/magic-link/verify?token=not-a-real-token&errorCallbackURL=https%3A%2F%2Fevil.example.com", {
      ipAddress: "198.51.102.200",
    });
    expect(badToken.status).toBe(400);
    expect(badToken.headers.get("location")).toBeNull();

    // The rejected attempts did not consume the token: a clean verify still works, with deep-link error/new-user URLs.
    magicLink.searchParams.set("newUserCallbackURL", "bjjroll://auth/welcome");
    magicLink.searchParams.set("errorCallbackURL", "bjjroll://auth/error");
    const cleanVerify = await getAuthPath(app, magicLink.toString(), { ipAddress: "198.51.102.201" });
    expect(cleanVerify.status).toBe(302);
    const location = cleanVerify.headers.get("location") ?? "";
    expect(location.startsWith("bjjroll://auth/welcome?code=")).toBe(true);
  });
});
