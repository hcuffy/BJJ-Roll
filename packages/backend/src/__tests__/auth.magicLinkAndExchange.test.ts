import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
      body: { email, callbackURL: DEEP_LINK_CALLBACK_URL },
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

  it("rejects expired magic-link tokens and expired 60s exchange codes", async () => {
    const { app, pool, codec } = current();
    const email = "expired.magic@example.com";
    const ipAddress = "198.51.100.22";

    // 1. Expired magic link
    await postAuthJson(app, "/sign-in/magic-link", {
      body: { email, callbackURL: DEEP_LINK_CALLBACK_URL },
      ipAddress,
    });
    const firstMagicUrl = latestMagicLinkFor(email);
    const firstRawToken = new URL(firstMagicUrl).searchParams.get("token") ?? "";
    await pool.query("UPDATE public.verifications SET expires_at = now() - interval '1 second' WHERE identifier = $1", [
      `magic-link:${codec.hashMagicLinkToken(firstRawToken)}`,
    ]);
    const expiredVerify = await getAuthPath(app, firstMagicUrl, { ipAddress });
    expect(expiredVerify.headers.get("location") ?? "").not.toContain("code=");

    // 2. Expired 60s exchange code
    await postAuthJson(app, "/sign-in/magic-link", {
      body: { email, callbackURL: DEEP_LINK_CALLBACK_URL },
      ipAddress,
    });
    const secondMagicUrl = latestMagicLinkFor(email);
    const validVerify = await getAuthPath(app, secondMagicUrl, { ipAddress });
    const redirectLocation = validVerify.headers.get("location") ?? "";
    const exchangeCode = new URL(redirectLocation).searchParams.get("code") ?? "";
    expect(exchangeCode.length).toBeGreaterThan(16);

    await pool.query("UPDATE public.verifications SET expires_at = now() - interval '1 second' WHERE identifier = $1", [
      `magic-link-exchange:${codec.hashExchangeCode(exchangeCode)}`,
    ]);

    const expiredExchange = await postAuthJson(app, "/exchange-code", {
      body: { code: exchangeCode },
      ipAddress,
    });
    expect(expiredExchange.status).toBe(401);
  });

  it("rejects non-bjjroll callbackURL to prevent open redirects", async () => {
    const { app } = current();
    const response = await postAuthJson(app, "/sign-in/magic-link", {
      body: {
        email: "redirect.check@example.com",
        callbackURL: "https://evil.example.com/steal",
      },
      ipAddress: "198.51.100.23",
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});
