import { describe, expect, it } from "vitest";
import {
  AUTH_DATA_ENCRYPTION_KEY_ENV,
  AUTH_EMAIL_HMAC_KEY_ENV,
  DEEP_LINK_CALLBACK_URL,
  DEEP_LINK_SCHEME,
  MAGIC_LINK_EXCHANGE_CODE_EXPIRY_SECONDS,
  MAGIC_LINK_EXPIRY_MINUTES,
  MAGIC_LINK_EXPIRY_SECONDS,
  MAX_SENDS_PER_EMAIL_PER_WINDOW,
  MAX_SENDS_PER_IP_PER_WINDOW,
  MAX_VERIFIES_PER_IP_PER_WINDOW,
  OTP_EXPIRY_MINUTES,
  OTP_EXPIRY_SECONDS,
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  RATE_LIMIT_WINDOW_SECONDS,
  SESSION_ABSOLUTE_MAX_LIFETIME_DAYS,
  SESSION_ABSOLUTE_MAX_LIFETIME_SECONDS,
  SESSION_SLIDING_EXPIRY_DAYS,
  SESSION_SLIDING_EXPIRY_SECONDS,
  SESSION_UPDATE_AGE_DAYS,
  SESSION_UPDATE_AGE_SECONDS,
  createAuthCryptoCodec,
  generateCsprngOtpCode,
  generateTestAuthSecrets,
  loadAuthKeyringFromEnvironment,
} from "../auth/index.js";

describe("HEN-71 authLimits and authSecrets unit suite", () => {
  it("exports the exact M2-05 OTP, magic-link, exchange, rate-limit, and session constants", () => {
    expect(OTP_LENGTH).toBe(6);
    expect(OTP_EXPIRY_MINUTES).toBe(10);
    expect(OTP_EXPIRY_SECONDS).toBe(600);
    expect(OTP_MAX_ATTEMPTS).toBe(5);

    expect(MAGIC_LINK_EXPIRY_MINUTES).toBe(15);
    expect(MAGIC_LINK_EXPIRY_SECONDS).toBe(900);
    expect(MAGIC_LINK_EXCHANGE_CODE_EXPIRY_SECONDS).toBe(60);

    expect(RATE_LIMIT_WINDOW_SECONDS).toBe(900);
    expect(MAX_SENDS_PER_EMAIL_PER_WINDOW).toBe(3);
    expect(MAX_SENDS_PER_IP_PER_WINDOW).toBe(10);
    expect(MAX_VERIFIES_PER_IP_PER_WINDOW).toBe(20);

    expect(SESSION_SLIDING_EXPIRY_DAYS).toBe(30);
    expect(SESSION_SLIDING_EXPIRY_SECONDS).toBe(30 * 24 * 60 * 60);
    expect(SESSION_UPDATE_AGE_DAYS).toBe(1);
    expect(SESSION_UPDATE_AGE_SECONDS).toBe(24 * 60 * 60);
    expect(SESSION_ABSOLUTE_MAX_LIFETIME_DAYS).toBe(90);
    expect(SESSION_ABSOLUTE_MAX_LIFETIME_SECONDS).toBe(90 * 24 * 60 * 60);

    expect(DEEP_LINK_SCHEME).toBe("bjjroll");
    expect(DEEP_LINK_CALLBACK_URL).toBe("bjjroll://auth/callback");
  });

  it("requires both distinct 32-byte deploy-time secrets at startup", () => {
    const validSecrets = generateTestAuthSecrets();
    expect(() =>
      loadAuthKeyringFromEnvironment({
        [AUTH_EMAIL_HMAC_KEY_ENV]: validSecrets[AUTH_EMAIL_HMAC_KEY_ENV],
      }),
    ).toThrow(AUTH_DATA_ENCRYPTION_KEY_ENV);

    expect(() =>
      loadAuthKeyringFromEnvironment({
        [AUTH_DATA_ENCRYPTION_KEY_ENV]: validSecrets[AUTH_DATA_ENCRYPTION_KEY_ENV],
      }),
    ).toThrow(AUTH_EMAIL_HMAC_KEY_ENV);

    expect(() =>
      loadAuthKeyringFromEnvironment({
        [AUTH_DATA_ENCRYPTION_KEY_ENV]: "short",
        [AUTH_EMAIL_HMAC_KEY_ENV]: validSecrets[AUTH_EMAIL_HMAC_KEY_ENV],
      }),
    ).toThrow(/64-character hex string/u);

    const identicalHex = validSecrets[AUTH_DATA_ENCRYPTION_KEY_ENV];
    expect(() =>
      loadAuthKeyringFromEnvironment({
        [AUTH_DATA_ENCRYPTION_KEY_ENV]: identicalHex,
        [AUTH_EMAIL_HMAC_KEY_ENV]: identicalHex,
      }),
    ).toThrow(/distinct deploy-time secrets/u);
  });

  it("encrypts user email with AES-256-GCM and domain-separates OTP, magic-link, and exchange hashes", () => {
    const keyring = loadAuthKeyringFromEnvironment(generateTestAuthSecrets());
    const codec = createAuthCryptoCodec(keyring);

    const encrypted = codec.encryptUserEmail("  Gracie.Fighter@BJJ.Test ");
    expect(encrypted.emailCiphertext.startsWith("v1:")).toBe(true);
    expect(encrypted.emailCiphertext).not.toContain("gracie");
    expect(encrypted.emailHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(encrypted.emailHash).toBe(codec.computeEmailHmac("gracie.fighter@bjj.test"));
    expect(codec.decryptUserEmail(encrypted.emailCiphertext, encrypted.keyVersion)).toBe("gracie.fighter@bjj.test");

    const sampleToken = "123456";
    const otpHash = codec.hashOtpCode(sampleToken);
    const magicLinkHash = codec.hashMagicLinkToken(sampleToken);
    const exchangeHash = codec.hashExchangeCode(sampleToken);
    expect(otpHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(magicLinkHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(exchangeHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(otpHash).not.toBe(magicLinkHash);
    expect(otpHash).not.toBe(exchangeHash);
    expect(magicLinkHash).not.toBe(exchangeHash);
  });

  it("generates 6-digit numeric CSPRNG OTP codes", () => {
    for (let iteration = 0; iteration < 50; iteration += 1) {
      const code = generateCsprngOtpCode();
      expect(code).toMatch(/^\d{6}$/u);
    }
  });
});
