import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import {
  APPLE_KEY_ID_ENV,
  APPLE_SERVICE_ID_ENV,
  AUTH_DATA_ENCRYPTION_KEY_ENV,
  AUTH_EMAIL_HMAC_KEY_ENV,
  generateTestAuthSecrets,
  GOOGLE_CLIENT_ID_ENV,
  GOOGLE_CLIENT_SECRET_ENV,
  isAllowedDeepLinkCallbackUrl,
} from "../auth/index.js";
import {
  AUTH_BASE_URL_ENV,
  AUTH_TRUSTED_PROXY_IP_HEADERS_ENV,
  DATABASE_URL_ENV,
  EMAIL_FROM_ADDRESS_ENV,
  LETTERMINT_API_KEY_ENV,
  loadServerConfig,
} from "../serverConfig.js";
import { isPostgresTestEnvironmentAvailable } from "./databaseTestHarness.js";
import {
  extractSessionCookie,
  postAuthJson,
  socketEnvironment,
  startAuthTestEnvironment,
  testBaseUrl,
  type StartedAuthTestEnvironment,
} from "./authTestHelper.js";

const validEnvironment = (): Record<string, string> => ({
  ...generateTestAuthSecrets(),
  [AUTH_BASE_URL_ENV]: "https://api.example.test",
  [DATABASE_URL_ENV]: "postgres://app@db.example.test/bjj",
  [LETTERMINT_API_KEY_ENV]: "lm-test-value-not-a-secret",
  [EMAIL_FROM_ADDRESS_ENV]: "login@example.test",
  [GOOGLE_CLIENT_ID_ENV]: "test-google-client.apps.example.test",
  [GOOGLE_CLIENT_SECRET_ENV]: "test-google-secret-not-real",
});

describe("HEN-71 startup config check", () => {
  it("accepts a complete environment and defaults to no trusted proxy headers", () => {
    const config = loadServerConfig(validEnvironment());
    expect(config.trustedProxyIpHeaders).toEqual([]);
    expect(config.port).toBe(3000);
    expect(loadServerConfig({ ...validEnvironment(), [AUTH_TRUSTED_PROXY_IP_HEADERS_ENV]: "X-Forwarded-For" }).trustedProxyIpHeaders).toEqual([
      "x-forwarded-for",
    ]);
  });

  it("fails fast on each missing or invalid variable and never echoes a value", () => {
    const base = validEnvironment();
    const cases: [string, Record<string, string | undefined>][] = [
      [AUTH_DATA_ENCRYPTION_KEY_ENV, { [AUTH_DATA_ENCRYPTION_KEY_ENV]: undefined }],
      [AUTH_EMAIL_HMAC_KEY_ENV, { [AUTH_EMAIL_HMAC_KEY_ENV]: undefined }],
      [AUTH_DATA_ENCRYPTION_KEY_ENV, { [AUTH_DATA_ENCRYPTION_KEY_ENV]: "abc123-short-secret-value" }],
      ["distinct", { [AUTH_EMAIL_HMAC_KEY_ENV]: base[AUTH_DATA_ENCRYPTION_KEY_ENV] }],
      [AUTH_BASE_URL_ENV, { [AUTH_BASE_URL_ENV]: undefined }],
      [AUTH_BASE_URL_ENV, { [AUTH_BASE_URL_ENV]: "not a url value" }],
      [DATABASE_URL_ENV, { [DATABASE_URL_ENV]: undefined }],
      [LETTERMINT_API_KEY_ENV, { [LETTERMINT_API_KEY_ENV]: "" }],
      [EMAIL_FROM_ADDRESS_ENV, { [EMAIL_FROM_ADDRESS_ENV]: undefined }],
      [AUTH_TRUSTED_PROXY_IP_HEADERS_ENV, { [AUTH_TRUSTED_PROXY_IP_HEADERS_ENV]: "x-evil-header-value" }],
      [GOOGLE_CLIENT_ID_ENV, { [GOOGLE_CLIENT_ID_ENV]: undefined }],
      [GOOGLE_CLIENT_SECRET_ENV, { [GOOGLE_CLIENT_SECRET_ENV]: "" }],
      // Apple is off until every Apple variable is set; a half-set Apple config fails fast instead of signing in half-configured.
      [APPLE_SERVICE_ID_ENV, { [APPLE_KEY_ID_ENV]: "TESTKEY001" }],
    ];
    for (const [expectedName, override] of cases) {
      const environment = { ...base, ...override };
      let message = "";
      try {
        loadServerConfig(environment);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect({ expectedName, mentioned: message.includes(expectedName) }).toEqual({ expectedName, mentioned: true });
      for (const value of Object.values(environment)) {
        if (value && value.length > 8) {
          expect(message).not.toContain(value);
        }
      }
    }
  });

  it("createApp without auth exposes /health only; /api/auth is mounted only with auth", async () => {
    const app = createApp();
    expect((await app.request("/health")).status).toBe(200);
    expect((await app.request(`${testBaseUrl}/api/auth/get-session`, {}, socketEnvironment("198.51.100.1"))).status).toBe(404);
  });

  it("deep-link callback check accepts only bjjroll://auth", () => {
    for (const allowedUrl of ["bjjroll://auth", "bjjroll://auth/callback", "bjjroll://auth/callback?x=1", "bjjroll://auth#frag"]) {
      expect({ allowedUrl, allowed: isAllowedDeepLinkCallbackUrl(allowedUrl) }).toEqual({ allowedUrl, allowed: true });
    }
    for (const bad of [
      "bjjroll://authx",
      "bjjroll://auth@evil.example.com",
      "bjjroll://auth\\@evil",
      "bjjroll:%2F%2Fauth",
      "https://auth",
      "",
      42,
      null,
    ]) {
      expect({ bad, allowed: isAllowedDeepLinkCallbackUrl(bad) }).toEqual({ bad, allowed: false });
    }
  });
});

describe.skipIf(!isPostgresTestEnvironmentAvailable())("HEN-71 handle routes use the real Better Auth session", () => {
  let environment: StartedAuthTestEnvironment | undefined;

  beforeAll(async () => {
    environment = await startAuthTestEnvironment();
  }, 60_000);

  afterAll(async () => {
    await environment?.stop();
  }, 30_000);

  it("a signed-in session cookie reads and sets the handle; no cookie or a spoofed header is 401", async () => {
    if (!environment) {
      throw new Error("Auth test environment not initialized");
    }
    const { app, emailSender } = environment;
    const ipAddress = "198.51.100.95";
    const email = "handle.wiring@example.com";
    await postAuthJson(app, "/email-otp/send-verification-otp", { body: { email, type: "sign-in", ageConfirmed: true }, ipAddress });
    const sent = emailSender.sentMessages.at(-1);
    if (sent?.kind !== "one_time_code") {
      throw new Error("No OTP sent");
    }
    const signIn = await postAuthJson(app, "/sign-in/email-otp", { body: { email, otp: sent.code }, ipAddress });
    const { user } = (await signIn.json()) as { user: { id: string } };
    const cookie = extractSessionCookie(signIn);

    const anonymous = await app.request(`${testBaseUrl}/handles/me`, {}, socketEnvironment(ipAddress));
    expect(anonymous.status).toBe(401);
    const spoofed = await app.request(
      `${testBaseUrl}/handles`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-authenticated-user-id": user.id },
        body: JSON.stringify({ handle: "spoofed_wiring" }),
      },
      socketEnvironment(ipAddress),
    );
    expect(spoofed.status).toBe(401);

    const setHandle = await app.request(
      `${testBaseUrl}/handles`,
      { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ handle: "wired_roller" }) },
      socketEnvironment(ipAddress),
    );
    expect(setHandle.status).toBe(200);
    const ownHandle = await app.request(`${testBaseUrl}/handles/me`, { headers: { cookie } }, socketEnvironment(ipAddress));
    expect(ownHandle.status).toBe(200);
    expect(await ownHandle.json()).toMatchObject({ id: user.id, handle: "wired_roller" });
  });
});
