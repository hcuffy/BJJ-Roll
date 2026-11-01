import { createHmac, randomBytes, randomInt } from "node:crypto";
import {
  createKeyring,
  decryptEmail,
  emailLookupHash,
  encryptEmail,
  ENCRYPTION_KEY_BYTES,
  normalizeEmail,
  type EncryptedEmail,
  type Keyring,
} from "@bjj-roll/shared/encryption";
import { OTP_LENGTH } from "./authLimits.js";

export const AUTH_DATA_ENCRYPTION_KEY_ENV = "AUTH_DATA_ENCRYPTION_KEY";
export const AUTH_EMAIL_HMAC_KEY_ENV = "AUTH_EMAIL_HMAC_KEY";

export interface AuthSecretEnvironment {
  readonly [AUTH_DATA_ENCRYPTION_KEY_ENV]?: string;
  readonly [AUTH_EMAIL_HMAC_KEY_ENV]?: string;
  readonly AUTH_DATA_KEY_VERSION?: string;
  readonly [key: string]: string | undefined;
}

export interface AuthSecretConfig {
  readonly dataEncryptionKeyHex: string;
  readonly hmacSecretKeyHex: string;
  readonly keyVersion?: number;
  readonly previousDataEncryptionKeys?: Readonly<Record<number, string>>;
}

interface EncryptedUserEmailFields {
  readonly emailCiphertext: string;
  readonly emailHash: string;
  readonly keyVersion: number;
}

export interface AuthCryptoCodec {
  readonly keyring: Keyring;
  readonly betterAuthSecret: string;
  deriveBetterAuthSecret(): string;
  encryptUserEmail(email: string): EncryptedUserEmailFields;
  decryptUserEmail(emailCiphertext: string, keyVersion: number): string;
  computeEmailHmac(email: string): string;
  encryptVerificationPayload(plaintext: string): string;
  decryptVerificationPayload(ciphertextPayload: string): string;
  hashOtpCode(otp: string): string;
  hashMagicLinkToken(token: string): string;
  hashExchangeCode(code: string): string;
  hashSessionToken(token: string): string;
  hashEmailQueueJobKey(jobKey: string): string;
  hashClientIp(clientIp: string): string;
}

const hexKeyPattern = /^[0-9a-fA-F]{64}$/u;

function parseThirtyTwoByteHexKey(rawHex: string, secretLabel: string): Buffer {
  const trimmed = rawHex.trim();
  if (!hexKeyPattern.test(trimmed)) {
    throw new Error(`${secretLabel} must be a 64-character hex string (${String(ENCRYPTION_KEY_BYTES)} bytes)`);
  }
  const buffer = Buffer.from(trimmed, "hex");
  if (buffer.byteLength !== ENCRYPTION_KEY_BYTES) {
    throw new Error(`${secretLabel} decoded to ${String(buffer.byteLength)} bytes; expected 32`);
  }
  return buffer;
}

function serializeEncryptedEmail(encrypted: EncryptedEmail): string {
  return [
    `v${String(encrypted.keyVersion)}`,
    encrypted.nonce.toString("base64url"),
    encrypted.ciphertext.toString("base64url"),
    encrypted.authTag.toString("base64url"),
  ].join(":");
}

function deserializeEncryptedEmail(serialized: string, fallbackKeyVersion?: number): EncryptedEmail {
  const parts = serialized.split(":");
  if (parts.length !== 4 || !parts[0]?.startsWith("v")) {
    throw new Error("Invalid serialized encrypted payload");
  }
  const parsedVersion = Number(parts[0].slice(1));
  const resolvedVersion = fallbackKeyVersion ?? (Number.isInteger(parsedVersion) && parsedVersion >= 1 ? parsedVersion : 1);
  return {
    keyVersion: resolvedVersion,
    nonce: Buffer.from(parts[1] ?? "", "base64url"),
    ciphertext: Buffer.from(parts[2] ?? "", "base64url"),
    authTag: Buffer.from(parts[3] ?? "", "base64url"),
  };
}

function computeDomainSeparatedHmac(keyring: Keyring, domain: string, value: string): string {
  const domainKey = emailLookupHash(keyring, `domain:${domain}@internal.bjjroll`);
  const hmac = createHmac("sha256", domainKey);
  hmac.update(`${domain}:${value}`, "utf8");
  return hmac.digest("hex");
}

function isKeyringInstance(input: Keyring | AuthSecretConfig): input is Keyring {
  return "currentKeyVersion" in input && "dataKeyFor" in input && "hmacKey" in input;
}

export function loadAuthKeyringFromEnvironment(env: AuthSecretEnvironment = process.env): Keyring {
  const dataEncryptionKeyHex = env[AUTH_DATA_ENCRYPTION_KEY_ENV] ?? "";
  const hmacSecretKeyHex = env[AUTH_EMAIL_HMAC_KEY_ENV] ?? "";
  if (!dataEncryptionKeyHex) {
    throw new Error(`Missing required deploy-time secret ${AUTH_DATA_ENCRYPTION_KEY_ENV}`);
  }
  if (!hmacSecretKeyHex) {
    throw new Error(`Missing required deploy-time secret ${AUTH_EMAIL_HMAC_KEY_ENV}`);
  }
  const rawVersion = env.AUTH_DATA_KEY_VERSION;
  const parsedVersion = rawVersion ? Number(rawVersion) : 1;
  if (!Number.isInteger(parsedVersion) || parsedVersion < 1) {
    throw new Error("AUTH_DATA_KEY_VERSION must be a positive integer when provided");
  }
  const dataKeyBuffer = parseThirtyTwoByteHexKey(dataEncryptionKeyHex, AUTH_DATA_ENCRYPTION_KEY_ENV);
  const hmacSecretBuffer = parseThirtyTwoByteHexKey(hmacSecretKeyHex, AUTH_EMAIL_HMAC_KEY_ENV);
  if (dataKeyBuffer.equals(hmacSecretBuffer)) {
    throw new Error(`${AUTH_DATA_ENCRYPTION_KEY_ENV} and ${AUTH_EMAIL_HMAC_KEY_ENV} must be distinct deploy-time secrets`);
  }
  return createKeyring({
    currentKeyVersion: parsedVersion,
    dataKeys: [{ keyVersion: parsedVersion, key: dataKeyBuffer }],
    hmacKey: hmacSecretBuffer,
  });
}

export function generateTestAuthSecrets(): AuthSecretEnvironment {
  const dataKey = randomBytes(ENCRYPTION_KEY_BYTES).toString("hex");
  let hmacKey = randomBytes(ENCRYPTION_KEY_BYTES).toString("hex");
  while (hmacKey === dataKey) {
    hmacKey = randomBytes(ENCRYPTION_KEY_BYTES).toString("hex");
  }
  return {
    [AUTH_DATA_ENCRYPTION_KEY_ENV]: dataKey,
    [AUTH_EMAIL_HMAC_KEY_ENV]: hmacKey,
  };
}

export function generateCsprngOtpCode(): string {
  const upperBound = 10 ** OTP_LENGTH;
  return randomInt(0, upperBound).toString().padStart(OTP_LENGTH, "0");
}

export function createAuthCryptoCodec(keyringOrConfig: Keyring | AuthSecretConfig): AuthCryptoCodec {
  let keyring: Keyring;
  if (isKeyringInstance(keyringOrConfig)) {
    keyring = keyringOrConfig;
  } else {
    const currentKeyVersion = keyringOrConfig.keyVersion ?? 1;
    const dataKeyBuffer = parseThirtyTwoByteHexKey(keyringOrConfig.dataEncryptionKeyHex, AUTH_DATA_ENCRYPTION_KEY_ENV);
    const hmacSecretBuffer = parseThirtyTwoByteHexKey(keyringOrConfig.hmacSecretKeyHex, AUTH_EMAIL_HMAC_KEY_ENV);
    if (dataKeyBuffer.equals(hmacSecretBuffer)) {
      throw new Error(`${AUTH_DATA_ENCRYPTION_KEY_ENV} and ${AUTH_EMAIL_HMAC_KEY_ENV} must be distinct deploy-time secrets`);
    }
    const dataKeys = [{ keyVersion: currentKeyVersion, key: dataKeyBuffer }];
    if (keyringOrConfig.previousDataEncryptionKeys) {
      for (const [versionKey, hexValue] of Object.entries(keyringOrConfig.previousDataEncryptionKeys)) {
        dataKeys.push({
          keyVersion: Number(versionKey),
          key: parseThirtyTwoByteHexKey(hexValue, `previousDataEncryptionKeys[${versionKey}]`),
        });
      }
    }
    keyring = createKeyring({
      currentKeyVersion,
      dataKeys,
      hmacKey: hmacSecretBuffer,
    });
  }

  const betterAuthSecret = computeDomainSeparatedHmac(keyring, "better-auth-cookie-signing-v1", "session-secret");

  return {
    keyring,
    betterAuthSecret,
    deriveBetterAuthSecret(): string {
      return betterAuthSecret;
    },
    encryptUserEmail(email: string): EncryptedUserEmailFields {
      const normalized = normalizeEmail(email);
      const encrypted = encryptEmail(keyring, normalized);
      const emailHash = emailLookupHash(keyring, normalized).toString("hex");
      return {
        emailCiphertext: serializeEncryptedEmail(encrypted),
        emailHash,
        keyVersion: encrypted.keyVersion,
      };
    },
    decryptUserEmail(emailCiphertext: string, keyVersion: number): string {
      const parsed = deserializeEncryptedEmail(emailCiphertext, keyVersion);
      return decryptEmail(keyring, parsed);
    },
    computeEmailHmac(email: string): string {
      return emailLookupHash(keyring, email).toString("hex");
    },
    encryptVerificationPayload(plaintext: string): string {
      const encrypted = encryptEmail(keyring, plaintext);
      return serializeEncryptedEmail(encrypted);
    },
    decryptVerificationPayload(ciphertextPayload: string): string {
      const parsed = deserializeEncryptedEmail(ciphertextPayload);
      return decryptEmail(keyring, parsed);
    },
    hashOtpCode(otp: string): string {
      return computeDomainSeparatedHmac(keyring, "email-otp-v1", otp.trim());
    },
    hashMagicLinkToken(token: string): string {
      return computeDomainSeparatedHmac(keyring, "magic-link-token-v1", token.trim());
    },
    hashExchangeCode(code: string): string {
      return computeDomainSeparatedHmac(keyring, "magic-link-exchange-v1", code.trim());
    },
    hashSessionToken(token: string): string {
      return computeDomainSeparatedHmac(keyring, "session-token-v1", token);
    },
    hashEmailQueueJobKey(jobKey: string): string {
      return computeDomainSeparatedHmac(keyring, "email-queue-job-v1", jobKey);
    },
    hashClientIp(clientIp: string): string {
      return computeDomainSeparatedHmac(keyring, "client-ip-v1", clientIp);
    },
  };
}
