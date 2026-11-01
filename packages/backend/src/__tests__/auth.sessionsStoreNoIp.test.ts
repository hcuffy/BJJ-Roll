import { createHash, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { encodeCreateData, encodeUpdateData } from "../auth/authCodecTransform.js";
import { MAX_HANDLE_AVAILABILITY_CHECKS_PER_IP_PER_WINDOW, MAX_SENDS_PER_IP_PER_WINDOW } from "../auth/authLimits.js";
import {
  APPLE_TOKEN_ENDPOINT,
  createAuthCryptoCodec,
  DEEP_LINK_CALLBACK_URL,
  generateTestAuthSecrets,
  loadAuthKeyringFromEnvironment,
} from "../auth/index.js";
import { createAccountTestFlow } from "./accountTestFlow.js";
import {
  boundMagicLinkSend,
  continueMagicLink,
  currentSignUpAttestation,
  getAuthPath,
  postAuthJson,
  socketEnvironment,
  startAuthTestEnvironment,
  testBaseUrl,
  testSignInVerifier,
  testSignInVerifierHash,
  type StartedAuthTestEnvironment,
} from "./authTestHelper.js";
import { isPostgresTestEnvironmentAvailable } from "./databaseTestHarness.js";
import {
  cookieHeaderFrom,
  createFakeAppleIdentityTokenSigner,
  createFakeSocialProviderConfig,
  fakeGoogleConfig,
  stubProviderFetch,
  unsignedIdToken,
} from "./socialSignInTestDoubles.js";

const ipv4Pattern = /(?:\d{1,3}\.){3}\d{1,3}/u;
const ipv6Pattern = /(?:[0-9a-f]{1,4}:){2,}[0-9a-f]{0,4}/iu;
const socialProviders = createFakeSocialProviderConfig();
const appleBundleIdentifier =
  socialProviders.apple?.appBundleIdentifier ??
  (() => {
    throw new Error("fake Apple config missing");
  })();
const signer = createFakeAppleIdentityTokenSigner();
const ticked = { age16Confirmed: true, ...currentSignUpAttestation, age18Confirmed: false };

describe("sessions never store a client IP (codec)", () => {
  it("drops ipAddress when a session is created or updated, and keeps the rest", () => {
    const codec = createAuthCryptoCodec(loadAuthKeyringFromEnvironment(generateTestAuthSecrets()));
    const { encoded } = encodeCreateData("session", { id: "s1", token: "t", userId: "u", ipAddress: "198.51.100.1", userAgent: "ua" }, codec);
    expect(encoded).toEqual({ id: "s1", token: "t", userId: "u", userAgent: "ua" });
    expect(encodeUpdateData("session", { ipAddress: "2001:db8::1", userAgent: "ua2" }, codec)).toEqual({ userAgent: "ua2" });
  });
});

describe.skipIf(!isPostgresTestEnvironmentAvailable())("sessions never store a client IP, and rate limits still read the live request IP", () => {
  let environment: StartedAuthTestEnvironment | undefined;
  let providerFetch: ReturnType<typeof stubProviderFetch> | undefined;
  let nextGoogle: { subject: string; email: string } | undefined;

  const current = (): StartedAuthTestEnvironment => {
    if (!environment) {
      throw new Error("Auth test environment not initialized");
    }
    return environment;
  };
  const flow = createAccountTestFlow(current);

  beforeAll(async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    providerFetch = stubProviderFetch((url) => {
      if (url === "https://appleid.apple.com/auth/keys") {
        return Response.json(signer.jwks);
      }
      if (url === APPLE_TOKEN_ENDPOINT) {
        return Response.json({ access_token: "fake-apple-access", refresh_token: "fake-apple-refresh", token_type: "Bearer", expires_in: 3600 });
      }
      if (url === "https://oauth2.googleapis.com/token" && nextGoogle) {
        const idToken = unsignedIdToken({
          iss: "https://accounts.google.com",
          aud: fakeGoogleConfig.clientId,
          sub: nextGoogle.subject,
          email: nextGoogle.email,
          email_verified: true,
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 600,
        });
        return Response.json({ access_token: "fake-google-access", id_token: idToken, token_type: "Bearer", expires_in: 3600 });
      }
      return undefined;
    });
    environment = await startAuthTestEnvironment({ socialProviders });
  }, 60_000);

  afterAll(async () => {
    providerFetch?.restore();
    vi.restoreAllMocks();
    await environment?.stop();
  }, 30_000);

  const exchange = async (location: string | null, ipAddress: string): Promise<string> => {
    const code = new URL(location ?? "").searchParams.get("code") ?? "";
    const response = await postAuthJson(current().app, "/magic-link/exchange", { body: { code, verifier: testSignInVerifier }, ipAddress });
    expect(response.status).toBe(200);
    return ((await response.json()) as { user: { id: string } }).user.id;
  };

  const signInKinds: Record<string, (ipAddress: string) => Promise<string>> = {
    emailCode: async (ipAddress) => (await flow.signIn("no.ip.otp@example.com", ipAddress)).userId,
    magicLink: async (ipAddress) => {
      const email = "no.ip.link@example.com";
      const send = await postAuthJson(current().app, "/sign-in/magic-link", {
        body: { email, callbackURL: DEEP_LINK_CALLBACK_URL, age16Confirmed: true, ...currentSignUpAttestation, ...boundMagicLinkSend },
        ipAddress,
      });
      expect(send.status).toBe(200);
      const sent = current()
        .emailSender.sentMessages.filter((message) => message.kind === "magic_link" && message.to.toLowerCase() === email)
        .at(-1);
      const verify = await continueMagicLink(current().app, sent?.kind === "magic_link" ? sent.url : "", { ipAddress });
      expect(verify.status).toBe(303);
      return exchange(verify.headers.get("location"), ipAddress);
    },
    google: async (ipAddress) => {
      const start = await postAuthJson(current().app, "/sign-in/social", {
        body: {
          provider: "google",
          callbackURL: DEEP_LINK_CALLBACK_URL,
          errorCallbackURL: DEEP_LINK_CALLBACK_URL,
          disableRedirect: true,
          additionalData: { verifierHash: testSignInVerifierHash, ...ticked },
        },
        ipAddress,
      });
      expect(start.status).toBe(200);
      const state = new URL(((await start.json()) as { url: string }).url).searchParams.get("state") ?? "";
      nextGoogle = { subject: "google-sub-no-ip", email: "no.ip.google@example.com" };
      const callback = await getAuthPath(current().app, `/callback/google?code=fake&state=${encodeURIComponent(state)}`, {
        ipAddress,
        cookie: cookieHeaderFrom(start),
      });
      expect(callback.status).toBe(302);
      return exchange(callback.headers.get("location"), ipAddress);
    },
    apple: async (ipAddress) => {
      const nonce = randomBytes(32).toString("base64url");
      const token = signer.signIdentityToken({
        iss: "https://appleid.apple.com",
        aud: appleBundleIdentifier,
        sub: "apple-sub-no-ip",
        email: "no.ip.apple@example.com",
        email_verified: "true",
        nonce: createHash("sha256").update(nonce).digest("hex"),
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 600,
      });
      const response = await postAuthJson(current().app, "/sign-in/social", {
        body: { provider: "apple", idToken: { token, nonce }, additionalData: { ...ticked, appleAuthorizationCode: "fake-apple-code" } },
        ipAddress,
      });
      expect(response.status).toBe(200);
      return ((await response.json()) as { user: { id: string } }).user.id;
    },
  };

  it.each(Object.keys(signInKinds))("sign-in by %s leaves ip_address null and no session column holding an IP", async (kind) => {
    const ipAddress = "198.51.100.77";
    const userId = await signInKinds[kind]?.(ipAddress);
    const rows = await current().pool.query<Record<string, unknown>>("SELECT * FROM public.sessions WHERE user_id = $1", [userId]);
    expect(rows.rows.length).toBeGreaterThan(0);
    for (const row of rows.rows) {
      expect(row.ip_address).toBeNull();
      for (const value of Object.values(row)) {
        const text = typeof value === "string" ? value : "";
        expect(text).not.toContain(ipAddress);
        expect(text).not.toMatch(ipv4Pattern);
        expect(isIP(text)).toBe(0);
      }
    }
  });

  it("no session row anywhere holds an IP after every sign-in kind", async () => {
    const rows = await current().pool.query<{ ip_address: string | null; user_agent: string | null }>(
      "SELECT ip_address, user_agent FROM public.sessions",
    );
    expect(rows.rows.length).toBeGreaterThanOrEqual(Object.keys(signInKinds).length);
    expect(rows.rows.filter((row) => row.ip_address !== null)).toEqual([]);
    for (const row of rows.rows) {
      expect(row.user_agent ?? "").not.toMatch(ipv4Pattern);
      expect(row.user_agent ?? "").not.toMatch(ipv6Pattern);
    }
  });

  it("the sign-in send limit still returns 429 at the limit from the live request IP, and another IP is not limited", async () => {
    const ipAddress = "198.51.100.88";
    const send = (email: string, fromIp: string) =>
      postAuthJson(current().app, "/email-otp/send-verification-otp", { body: { email, type: "sign-in", ...ticked }, ipAddress: fromIp });
    for (let attempt = 0; attempt < MAX_SENDS_PER_IP_PER_WINDOW; attempt += 1) {
      expect((await send(`limit.${String(attempt)}@example.com`, ipAddress)).status).toBe(200);
    }
    expect((await send("limit.over@example.com", ipAddress)).status).toBe(429);
    expect((await send("limit.other@example.com", "198.51.100.89")).status).toBe(200);
    const stored = await current().pool.query("SELECT 1 FROM public.sessions WHERE ip_address IS NOT NULL");
    expect(stored.rowCount).toBe(0);
  });

  it("/handles/availability returns 429 on the 11th call from one IP within a minute, and another IP is not limited", async () => {
    const check = (fromIp: string) => current().app.request(`${testBaseUrl}/handles/availability?handle=free_name`, {}, socketEnvironment(fromIp));
    for (let attempt = 0; attempt < MAX_HANDLE_AVAILABILITY_CHECKS_PER_IP_PER_WINDOW; attempt += 1) {
      expect((await check("198.51.100.90")).status).toBe(200);
    }
    const limited = await check("198.51.100.90");
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ available: false, error: "Too many requests" });
    expect((await check("198.51.100.91")).status).toBe(200);
    const keys = await current().pool.query<{ key: string }>("SELECT key FROM public.rate_limits WHERE key LIKE 'handle-availability:%'");
    expect(keys.rows.map((row) => row.key)).toEqual(
      expect.arrayContaining([`handle-availability:ip:${current().codec.hashClientIp("198.51.100.90")}`]),
    );
    expect(keys.rows.some((row) => row.key.includes("198.51.100"))).toBe(false);
  });

  it("the database refuses a handle that breaks the format rule", async () => {
    const user = await flow.signIn("bad.handle@example.com", "198.51.100.92");
    await expect(current().pool.query("UPDATE public.users SET handle = 'Bad Handle!' WHERE id = $1", [user.userId])).rejects.toMatchObject({
      code: "23514",
    });
    await expect(current().pool.query("UPDATE public.users SET handle = 'ab' WHERE id = $1", [user.userId])).rejects.toMatchObject({
      code: "23514",
    });
    await expect(current().pool.query("UPDATE public.users SET handle = 'good_name' WHERE id = $1", [user.userId])).resolves.toMatchObject({
      rowCount: 1,
    });
  });
});
