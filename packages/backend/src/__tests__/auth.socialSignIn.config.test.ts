import { createPublicKey, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isSocialSignUpAgeConfirmed } from "../auth/ageGate.js";
import { encodeCreateData, encodeUpdateData } from "../auth/authCodecTransform.js";
import {
  APPLE_ENVIRONMENT_NAMES,
  APPLE_REFRESH_TOKEN_ENVELOPE_PREFIX,
  buildSocialProviders,
  createAppleClientSecret,
  createAuthCryptoCodec,
  generateTestAuthSecrets,
  GOOGLE_CLIENT_ID_ENV,
  GOOGLE_CLIENT_SECRET_ENV,
  loadAuthKeyringFromEnvironment,
  loadSocialProviderConfig,
  openAppleRefreshToken,
} from "../auth/index.js";
import { createFakeAppleConfig, fakeGoogleConfig } from "./socialSignInTestDoubles.js";

const apple = createFakeAppleConfig();
const appleEnvironment = (): Record<string, string> => ({
  APPLE_SERVICE_ID: apple.serviceId,
  APPLE_APP_BUNDLE_IDENTIFIER: apple.appBundleIdentifier,
  APPLE_TEAM_ID: apple.teamId,
  APPLE_KEY_ID: apple.keyId,
  APPLE_PRIVATE_KEY: apple.privateKeyPem.replaceAll("\n", "\\n"),
});
const googleEnvironment = { [GOOGLE_CLIENT_ID_ENV]: fakeGoogleConfig.clientId, [GOOGLE_CLIENT_SECRET_ENV]: fakeGoogleConfig.clientSecret };
const codec = createAuthCryptoCodec(loadAuthKeyringFromEnvironment(generateTestAuthSecrets()));

const decodeJwtPart = (part: string | undefined): Record<string, unknown> =>
  JSON.parse(Buffer.from(part ?? "", "base64url").toString()) as Record<string, unknown>;

describe("HEN-239 social provider config", () => {
  it("turns Apple on only when every Apple variable is set; Google alone is valid", () => {
    expect(loadSocialProviderConfig(googleEnvironment, { requireGoogle: true })).toEqual({ google: fakeGoogleConfig });
    const both = loadSocialProviderConfig({ ...googleEnvironment, ...appleEnvironment() }, { requireGoogle: true });
    expect(both.apple).toEqual(apple);
    expect(Object.keys(buildSocialProviders(both, () => "unused")).sort()).toEqual(["apple", "google"]);
    expect(Object.keys(buildSocialProviders({ google: fakeGoogleConfig })).sort()).toEqual(["google"]);
  });

  it("fails fast naming the first missing variable of a half-set provider, never a value", () => {
    for (const missingName of APPLE_ENVIRONMENT_NAMES) {
      const environment = { ...googleEnvironment, ...appleEnvironment(), [missingName]: "" };
      expect(() => loadSocialProviderConfig(environment)).toThrow(`Missing required environment variable ${missingName}`);
    }
    expect(() => loadSocialProviderConfig({}, { requireGoogle: true })).toThrow(GOOGLE_CLIENT_ID_ENV);
    let message = "";
    try {
      loadSocialProviderConfig({ [GOOGLE_CLIENT_ID_ENV]: fakeGoogleConfig.clientId });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain(GOOGLE_CLIENT_SECRET_ENV);
    expect(message).not.toContain(fakeGoogleConfig.clientId);
  });

  it("refuses Google id tokens sent by a client; Google sign-in is browser-only", () => {
    const providers = buildSocialProviders({ google: fakeGoogleConfig });
    expect(providers.google).toMatchObject({ disableIdTokenSignIn: true });
  });

  it("signs the Apple client secret with the Apple key (ES256) for the asked client id", () => {
    const secret = createAppleClientSecret(apple, apple.serviceId, 1_800_000_000);
    const [header, payload, signature] = secret.split(".");
    expect(decodeJwtPart(header)).toEqual({ alg: "ES256", kid: apple.keyId });
    expect(decodeJwtPart(payload)).toEqual({
      iss: apple.teamId,
      iat: 1_800_000_000,
      exp: 1_800_000_000 + 180 * 24 * 60 * 60,
      aud: "https://appleid.apple.com",
      sub: apple.serviceId,
    });
    const publicKey = createPublicKey(apple.privateKeyPem);
    expect(
      verify("sha256", Buffer.from(`${header}.${payload}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature ?? "", "base64url")),
    ).toBe(true);
  });
});

describe("HEN-239 provider tokens at rest", () => {
  it("drops Google tokens and every access or id token before they reach the accounts table", () => {
    const { encoded } = encodeCreateData(
      "account",
      { providerId: "google", accountId: "google-sub", userId: "user-1", accessToken: "at", idToken: "it", refreshToken: "rt", scope: "openid" },
      codec,
    );
    expect(encoded).not.toHaveProperty("accessToken");
    expect(encoded).not.toHaveProperty("idToken");
    expect(encoded).not.toHaveProperty("refreshToken");
    expect(encoded).not.toHaveProperty("scope");
    expect(encodeUpdateData("account", { accessToken: "at", idToken: "it" }, codec)).toEqual({});
  });

  it("keeps Apple's refresh token only sealed, and passes an already sealed one through untouched", () => {
    const { encoded } = encodeCreateData(
      "account",
      { providerId: "apple", accountId: "apple-sub", userId: "user-1", refreshToken: "fake-apple-rt" },
      codec,
    );
    const sealed = String(encoded.refreshToken);
    expect(sealed.startsWith(APPLE_REFRESH_TOKEN_ENVELOPE_PREFIX)).toBe(true);
    expect(sealed).not.toContain("fake-apple-rt");
    expect(openAppleRefreshToken(codec, sealed)).toEqual({ refreshToken: "fake-apple-rt", clientId: null });
    expect(encodeUpdateData("account", { providerId: "apple", refreshToken: sealed }, codec).refreshToken).toBe(sealed);
    expect(openAppleRefreshToken(codec, "fake-apple-rt")).toBeNull();
  });
});

describe("HEN-239 age gate for social sign-up", () => {
  it("needs ageConfirmed true from the request (native token) or the OAuth state (browser), and nothing elsewhere", () => {
    expect(isSocialSignUpAgeConfirmed("/sign-in/social", { additionalData: { ageConfirmed: true } }, undefined)).toBe(true);
    expect(isSocialSignUpAgeConfirmed("/sign-in/social", { additionalData: { ageConfirmed: "true" } }, undefined)).toBe(false);
    expect(isSocialSignUpAgeConfirmed("/sign-in/social", {}, { ageConfirmed: true })).toBe(false);
    expect(isSocialSignUpAgeConfirmed("/callback/google", { additionalData: { ageConfirmed: true } }, undefined)).toBe(false);
    expect(isSocialSignUpAgeConfirmed("/callback/apple", undefined, { ageConfirmed: true })).toBe(true);
    expect(isSocialSignUpAgeConfirmed("/callback/apple", undefined, { ageConfirmed: false })).toBe(false);
    expect(isSocialSignUpAgeConfirmed("/sign-in/email-otp", undefined, undefined)).toBe(true);
  });
});
