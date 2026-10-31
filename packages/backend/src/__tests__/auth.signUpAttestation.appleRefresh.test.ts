import { createHash, randomBytes } from "node:crypto";
import { signUpAttestationVersion } from "@bjj-roll/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { currentSignUpAttestation, postAuthJson, startAuthTestEnvironment, type StartedAuthTestEnvironment } from "./authTestHelper.js";
import { isPostgresTestEnvironmentAvailable } from "./databaseTestHarness.js";
import { createFakeAppleIdentityTokenSigner, createFakeSocialProviderConfig, stubProviderFetch } from "./socialSignInTestDoubles.js";

const socialProviders = createFakeSocialProviderConfig();
const signer = createFakeAppleIdentityTokenSigner();

describe.skipIf(!isPostgresTestEnvironmentAvailable())("HEN-183 the Apple sign-in tick refreshes the attestation for existing accounts", () => {
  let environment: StartedAuthTestEnvironment | undefined;
  let providerFetch: ReturnType<typeof stubProviderFetch> | undefined;
  const current = (): StartedAuthTestEnvironment => {
    if (!environment) {
      throw new Error("Auth test environment not initialized");
    }
    return environment;
  };

  const signInWithApple = async (subject: string, email: string, additionalData: Record<string, unknown>): Promise<string> => {
    const nonce = randomBytes(32).toString("base64url");
    const token = signer.signIdentityToken({
      iss: "https://appleid.apple.com",
      aud: socialProviders.apple?.appBundleIdentifier,
      sub: subject,
      email,
      email_verified: "true",
      nonce: createHash("sha256").update(nonce).digest("hex"),
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    const response = await postAuthJson(current().app, "/sign-in/social", {
      body: { provider: "apple", idToken: { token, nonce }, additionalData },
      ipAddress: "198.51.100.250",
    });
    expect(response.status).toBe(200);
    return ((await response.json()) as { user: { id: string } }).user.id;
  };

  const attestationVersionsFor = async (userId: string): Promise<string[]> => {
    const result = await current().pool.query<{ text_version_id: string }>(
      "SELECT text_version_id FROM public.consent_records WHERE user_id = $1 AND consent_type = 'attestation_signup'",
      [userId],
    );
    return result.rows.map((row) => row.text_version_id);
  };

  beforeAll(async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    providerFetch = stubProviderFetch((url) => (url === "https://appleid.apple.com/auth/keys" ? Response.json(signer.jwks) : undefined));
    environment = await startAuthTestEnvironment({ socialProviders });
  }, 60_000);

  afterAll(async () => {
    providerFetch?.restore();
    vi.restoreAllMocks();
    await environment?.stop();
  }, 30_000);

  it("a returning Apple account with no record that ticks gets one at the current version; without the tick it gets none", async () => {
    const ticked = { age16Confirmed: true, ...currentSignUpAttestation };
    const userId = await signInWithApple("apple-sub-refresh", "refresh.apple.member@example.com", ticked);
    await current().pool.query("DELETE FROM public.consent_records WHERE user_id = $1 AND consent_type = 'attestation_signup'", [userId]);

    expect(await signInWithApple("apple-sub-refresh", "refresh.apple.member@example.com", { age16Confirmed: true })).toBe(userId);
    expect(await attestationVersionsFor(userId)).toEqual([]);
    expect(await signInWithApple("apple-sub-refresh", "refresh.apple.member@example.com", ticked)).toBe(userId);
    expect(await attestationVersionsFor(userId)).toEqual([signUpAttestationVersion.id]);
  });
});
