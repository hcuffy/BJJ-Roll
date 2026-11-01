import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { APPLE_TOKEN_ENDPOINT } from "../auth/index.js";
import { currentSignUpAttestation, postAuthJson, startAuthTestEnvironment, type StartedAuthTestEnvironment } from "./authTestHelper.js";
import { isPostgresTestEnvironmentAvailable } from "./databaseTestHarness.js";
import { createFakeAppleIdentityTokenSigner, createFakeSocialProviderConfig, stubProviderFetch } from "./socialSignInTestDoubles.js";

const socialProviders = createFakeSocialProviderConfig();
const appleBundleIdentifier =
  socialProviders.apple?.appBundleIdentifier ??
  (() => {
    throw new Error("fake Apple config missing");
  })();
const signer = createFakeAppleIdentityTokenSigner();

describe.skipIf(!isPostgresTestEnvironmentAvailable())("Sign in with Apple when the Apple email changes", () => {
  let environment: StartedAuthTestEnvironment | undefined;
  let providerFetch: ReturnType<typeof stubProviderFetch> | undefined;

  const current = (): StartedAuthTestEnvironment => {
    if (!environment) {
      throw new Error("Auth test environment not initialized");
    }
    return environment;
  };

  const countRows = async (table: "users" | "accounts"): Promise<number> => {
    const result = await current().pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM public.${table}`);
    return result.rows[0]?.count ?? 0;
  };

  const signInWithApple = (email: string): Promise<Response> => {
    const nonce = randomBytes(32).toString("base64url");
    const token = signer.signIdentityToken({
      iss: "https://appleid.apple.com",
      aud: appleBundleIdentifier,
      sub: "apple-sub-email-changed",
      email,
      email_verified: "true",
      nonce: createHash("sha256").update(nonce).digest("hex"),
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    const additionalData = { age16Confirmed: true, ...currentSignUpAttestation, age18Confirmed: false, appleAuthorizationCode: "fake-apple-code" };
    return postAuthJson(current().app, "/sign-in/social", {
      body: { provider: "apple", idToken: { token, nonce }, additionalData },
      ipAddress: "198.51.100.217",
    });
  };

  beforeAll(async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    providerFetch = stubProviderFetch((url) => {
      if (url === "https://appleid.apple.com/auth/keys") {
        return Response.json(signer.jwks);
      }
      if (url === APPLE_TOKEN_ENDPOINT) {
        return Response.json({ access_token: "fake-apple-access", refresh_token: "fake-apple-refresh", token_type: "Bearer", expires_in: 3600 });
      }
      return undefined;
    });
    environment = await startAuthTestEnvironment({ socialProviders });
  }, 60_000);

  afterAll(async () => {
    providerFetch?.restore();
    vi.restoreAllMocks();
    await environment?.stop();
  }, 60_000);

  it("B7: the same Apple sub with a changed email signs in to the same user, with one user and one account", async () => {
    const first = await signInWithApple("before.change.apple@example.com");
    expect(first.status).toBe(200);
    const userId = ((await first.json()) as { user: { id: string } }).user.id;
    const before = { users: await countRows("users"), accounts: await countRows("accounts") };

    const again = await signInWithApple("after.change.apple@example.com");
    expect(again.status).toBe(200);
    expect(((await again.json()) as { user: { id: string } }).user.id).toBe(userId);
    expect({ users: await countRows("users"), accounts: await countRows("accounts") }).toEqual(before);
    const accounts = await current().pool.query("SELECT user_id FROM public.accounts WHERE provider_id = 'apple' AND account_id = $1", [
      "apple-sub-email-changed",
    ]);
    expect(accounts.rows).toEqual([{ user_id: userId }]);
  });
});
