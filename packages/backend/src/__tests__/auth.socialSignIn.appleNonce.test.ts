import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claimNonceOnce } from "../auth/socialSignInSafety.js";
import { isPostgresTestEnvironmentAvailable } from "./databaseTestHarness.js";
import { extractSessionCookie, postAuthJson, startAuthTestEnvironment, type StartedAuthTestEnvironment } from "./authTestHelper.js";
import { createFakeAppleIdentityTokenSigner, createFakeSocialProviderConfig, stubProviderFetch } from "./socialSignInTestDoubles.js";

const socialProviders = createFakeSocialProviderConfig();
const apple =
  socialProviders.apple ??
  (() => {
    throw new Error("fake Apple config missing");
  })();
const signer = createFakeAppleIdentityTokenSigner();
const sha256Hex = (value: string): string => createHash("sha256").update(value).digest("hex");
const freshNonce = (): string => randomBytes(32).toString("base64url");
let nextIp = 30;

interface AppleClaims {
  readonly subject: string;
  readonly email: string;
  readonly overrides?: Record<string, unknown>;
  readonly omit?: readonly string[];
}

/** An identity token as Apple signs it for a native sign-in started with SHA-256(rawNonce). */
function identityToken({ subject, email, overrides = {}, omit = [] }: AppleClaims, rawNonce: string): string {
  const now = Math.floor(Date.now() / 1000);
  const claims: Record<string, unknown> = {
    iss: "https://appleid.apple.com",
    aud: apple.appBundleIdentifier,
    sub: subject,
    email,
    email_verified: "true",
    nonce: sha256Hex(rawNonce),
    iat: now,
    exp: now + 600,
    ...overrides,
  };
  for (const name of omit) {
    Reflect.deleteProperty(claims, name);
  }
  return signer.signIdentityToken(claims);
}

describe.skipIf(!isPostgresTestEnvironmentAvailable())("HEN-239 Apple native sign-in: nonce, replay and token claims", () => {
  let environment: StartedAuthTestEnvironment | undefined;
  let providerFetch: ReturnType<typeof stubProviderFetch> | undefined;

  const current = (): StartedAuthTestEnvironment => {
    if (!environment) {
      throw new Error("Auth test environment not initialized");
    }
    return environment;
  };

  const countRows = async (): Promise<Record<"users" | "sessions" | "accounts", number>> => {
    const result = await current().pool.query<{ users: number; sessions: number; accounts: number }>(
      "SELECT (SELECT count(*)::int FROM public.users) AS users, (SELECT count(*)::int FROM public.sessions) AS sessions, " +
        "(SELECT count(*)::int FROM public.accounts) AS accounts",
    );
    const row = result.rows[0];
    return { users: row?.users ?? -1, sessions: row?.sessions ?? -1, accounts: row?.accounts ?? -1 };
  };

  const postAppleIdToken = (idToken: { token: string; nonce?: unknown }): Promise<Response> => {
    nextIp += 1;
    return postAuthJson(current().app, "/sign-in/social", {
      body: { provider: "apple", idToken, additionalData: { age16Confirmed: true, age18Confirmed: false } },
      ipAddress: `198.51.100.${nextIp}`,
    });
  };

  const expectRefusedWithoutChanges = async (attempt: () => Promise<Response>, status = 401): Promise<Response> => {
    const before = await countRows();
    const response = await attempt();
    expect(response.status).toBe(status);
    expect(extractSessionCookie(response)).toBe("");
    expect(await countRows()).toEqual(before);
    return response;
  };

  beforeAll(async () => {
    providerFetch = stubProviderFetch((url) => (url === "https://appleid.apple.com/auth/keys" ? Response.json(signer.jwks) : undefined));
    environment = await startAuthTestEnvironment({ socialProviders });
  }, 60_000);

  afterAll(async () => {
    providerFetch?.restore();
    await environment?.stop();
  }, 30_000);

  it("signs in when Apple signed SHA-256 of the app's raw nonce, and refuses the same token and nonce sent again", async () => {
    const nonce = freshNonce();
    const token = identityToken({ subject: "apple-nonce-ok", email: "nonce.ok.apple@example.com" }, nonce);

    const first = await postAppleIdToken({ token, nonce });
    expect(first.status).toBe(200);
    expect(extractSessionCookie(first)).toContain("=");

    await expectRefusedWithoutChanges(() => postAppleIdToken({ token, nonce }));
  });

  it("refuses a second, freshly signed token that reuses an already-used nonce", async () => {
    const nonce = freshNonce();
    const claims = { subject: "apple-nonce-reuse", email: "nonce.reuse.apple@example.com" };
    expect((await postAppleIdToken({ token: identityToken(claims, nonce), nonce })).status).toBe(200);

    const reissued = identityToken({ ...claims, overrides: { iat: Math.floor(Date.now() / 1000) + 1 } }, nonce);
    await expectRefusedWithoutChanges(() => postAppleIdToken({ token: reissued, nonce }));
  });

  it("lets exactly one of many simultaneous replays through", async () => {
    const nonce = freshNonce();
    const token = identityToken({ subject: "apple-nonce-race", email: "nonce.race.apple@example.com" }, nonce);

    const statuses = await Promise.all(Array.from({ length: 12 }, () => postAppleIdToken({ token, nonce }))).then((responses) =>
      responses.map((response) => response.status),
    );

    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    expect(statuses.filter((status) => status === 401)).toHaveLength(11);
  });

  it("records a nonce claim exactly once when many requests claim it at the same moment", async () => {
    const claim = sha256Hex(freshNonce());
    const claimed = await Promise.all(Array.from({ length: 20 }, async () => await claimNonceOnce(current().appLogin.pool, claim)));
    expect(claimed.filter(Boolean)).toHaveLength(1);
  });

  it("does not use up a nonce on a token that fails verification", async () => {
    const nonce = freshNonce();
    const claims = { subject: "apple-nonce-forged-first", email: "nonce.forged.apple@example.com" };
    const wrongAudience = identityToken({ ...claims, overrides: { aud: "com.example.someone-else" } }, nonce);
    await expectRefusedWithoutChanges(() => postAppleIdToken({ token: wrongAudience, nonce }));

    expect((await postAppleIdToken({ token: identityToken(claims, nonce), nonce })).status).toBe(200);
  });

  it.each([
    { name: "no nonce from the app", idToken: (token: string) => ({ token }) },
    { name: "an empty nonce", idToken: (token: string) => ({ token, nonce: "" }) },
    { name: "a nonce that is not a string", idToken: (token: string) => ({ token, nonce: 12_345 }) },
    { name: "a different raw nonce", idToken: (token: string) => ({ token, nonce: freshNonce() }) },
  ] as { name: string; idToken: (token: string) => { token: string; nonce?: unknown } }[])(
    "refuses $name: no user, no session",
    async ({ idToken }) => {
      const token = identityToken({ subject: "apple-nonce-bad", email: "nonce.bad.apple@example.com" }, freshNonce());
      await expectRefusedWithoutChanges(() => postAppleIdToken(idToken(token)));
    },
  );

  it("refuses a token without a nonce claim", async () => {
    const nonce = freshNonce();
    const token = identityToken({ subject: "apple-nonce-unclaimed", email: "nonce.unclaimed.apple@example.com", omit: ["nonce"] }, nonce);
    await expectRefusedWithoutChanges(() => postAppleIdToken({ token, nonce }));
  });

  it("refuses an app that sends the token's own nonce claim (the hash) instead of the raw nonce", async () => {
    const token = identityToken({ subject: "apple-nonce-hash", email: "nonce.hash.apple@example.com" }, freshNonce());
    const claim = (JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString()) as { nonce: string }).nonce;
    await expectRefusedWithoutChanges(() => postAppleIdToken({ token, nonce: claim }));
  });

  it.each([
    { name: "another app's audience", overrides: { aud: "com.example.someone-else" } },
    { name: "another issuer", overrides: { iss: "https://appleid.example.com" } },
    { name: "an expired token", overrides: { iat: Math.floor(Date.now() / 1000) - 7200, exp: Math.floor(Date.now() / 1000) - 3600 } },
  ])("refuses $name even with a matching nonce", async ({ overrides }) => {
    const nonce = freshNonce();
    const token = identityToken({ subject: "apple-claims-bad", email: "claims.bad.apple@example.com", overrides }, nonce);
    await expectRefusedWithoutChanges(() => postAppleIdToken({ token, nonce }));
  });

  it.each([
    { name: "no email_verified claim", claims: { omit: ["email_verified"] } },
    { name: "email_verified false", claims: { overrides: { email_verified: "false" } } },
  ])("refuses an Apple token with $name, with the same response whether or not the email has an account", async ({ claims }) => {
    const takenEmail = `taken.${randomBytes(4).toString("hex")}.apple@example.com`;
    const ownerNonce = freshNonce();
    const owner = await postAppleIdToken({
      token: identityToken({ subject: `apple-owner-${takenEmail}`, email: takenEmail }, ownerNonce),
      nonce: ownerNonce,
    });
    expect(owner.status).toBe(200);
    const ownerId = ((await owner.json()) as { user: { id: string } }).user.id;

    const attempt = async (email: string): Promise<{ status: number; body: unknown }> => {
      const nonce = freshNonce();
      const token = identityToken({ subject: `apple-unverified-${email}`, email, ...claims }, nonce);
      const response = await expectRefusedWithoutChanges(() => postAppleIdToken({ token, nonce }));
      return { status: response.status, body: await response.json() };
    };
    const freshEmail = await attempt(`fresh.${randomBytes(4).toString("hex")}.apple@example.com`);
    const takenEmailAttempt = await attempt(takenEmail);

    expect(freshEmail).toEqual({ status: 401, body: { code: "OAUTH_LINK_ERROR", message: "account not linked" } });
    expect(takenEmailAttempt).toEqual(freshEmail);
    const accounts = await current().pool.query<{ count: number }>("SELECT count(*)::int AS count FROM public.accounts WHERE user_id = $1", [
      ownerId,
    ]);
    expect(accounts.rows[0]?.count).toBe(1);
  });
});
