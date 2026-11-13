import { randomUUID } from "node:crypto";
import type { Where } from "better-auth/adapters";
import { APPLE_REFRESH_TOKEN_ENVELOPE_PREFIX, sealAppleRefreshToken } from "./appleTokens.js";
import type { AuthCryptoCodec } from "./authSecrets.js";

const identifierEmailPrefixes = ["sign-in-otp-", "email-verification-otp-", "forget-password-otp-", "change-email-confirmation-"] as const;

const sixtyFourHexPattern = /^[0-9a-f]{64}$/u;

export function normalizeModelKey(model: string): string {
  const lowered = model.toLowerCase();
  if (lowered === "user" || lowered === "users") {
    return "user";
  }
  if (lowered === "session" || lowered === "sessions") {
    return "session";
  }
  if (lowered === "account" || lowered === "accounts") {
    return "account";
  }
  if (lowered === "verification" || lowered === "verifications") {
    return "verification";
  }
  if (lowered === "ratelimit" || lowered === "ratelimits" || lowered === "rate_limit" || lowered === "rate_limits") {
    return "rateLimit";
  }
  return model;
}

function encodeRateLimitKey(rawKey: string, codec: AuthCryptoCodec): string {
  const separator = rawKey.indexOf("|");
  if (separator < 0) {
    return codec.hashClientIp(rawKey);
  }
  return `${codec.hashClientIp(rawKey.slice(0, separator))}${rawKey.slice(separator)}`;
}

export function encodeRateLimitWhere(model: string, where: Where[] | undefined, codec: AuthCryptoCodec): Where[] | undefined {
  if (normalizeModelKey(model) !== "rateLimit" || where === undefined) {
    return where;
  }
  return where.map((clause) =>
    clause.field === "key" && typeof clause.value === "string" ? { ...clause, value: encodeRateLimitKey(clause.value, codec) } : clause,
  );
}

export function transformVerificationIdentifier(rawIdentifier: string, codec: AuthCryptoCodec): string {
  for (const prefix of identifierEmailPrefixes) {
    if (rawIdentifier.startsWith(prefix)) {
      const suffix = rawIdentifier.slice(prefix.length);
      if (sixtyFourHexPattern.test(suffix)) {
        return rawIdentifier;
      }
      return `${prefix}${codec.computeEmailHmac(suffix)}`;
    }
  }
  if (rawIdentifier.includes("@")) {
    return codec.computeEmailHmac(rawIdentifier);
  }
  return rawIdentifier;
}

export function extractEmailHmacFromIdentifier(rawIdentifier: string, codec: AuthCryptoCodec): string | null {
  for (const prefix of identifierEmailPrefixes) {
    if (rawIdentifier.startsWith(prefix)) {
      const suffix = rawIdentifier.slice(prefix.length);
      if (sixtyFourHexPattern.test(suffix)) {
        return suffix;
      }
      if (suffix.includes("@")) {
        return codec.computeEmailHmac(suffix);
      }
    }
  }
  return rawIdentifier.includes("@") ? codec.computeEmailHmac(rawIdentifier) : null;
}

function extractEmailFromVerificationValue(rawValue: string): string | null {
  if (!rawValue.startsWith("{")) {
    return null;
  }
  try {
    const parsed = JSON.parse(rawValue) as { email?: unknown };
    return typeof parsed.email === "string" && parsed.email.includes("@") ? parsed.email : null;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

const droppedAccountTokenFields = ["accessToken", "idToken", "accessTokenExpiresAt", "refreshTokenExpiresAt", "scope"] as const;

function encodeAccountTokens(encoded: Record<string, unknown>, codec: AuthCryptoCodec): void {
  for (const field of droppedAccountTokenFields) {
    delete encoded[field];
  }
  const refreshToken = encoded.refreshToken;
  if (typeof refreshToken !== "string" || refreshToken === "" || encoded.providerId !== "apple") {
    delete encoded.refreshToken;
  } else if (!refreshToken.startsWith(APPLE_REFRESH_TOKEN_ENVELOPE_PREFIX)) {
    encoded.refreshToken = sealAppleRefreshToken(codec, { refreshToken, clientId: null });
  }
}

export function encodeCreateData(
  model: string,
  data: Record<string, unknown>,
  codec: AuthCryptoCodec,
): { encoded: Record<string, unknown>; emailHmac: string | null } {
  const modelKey = normalizeModelKey(model);
  const encoded: Record<string, unknown> = { ...data };
  if (typeof encoded.id !== "string" || encoded.id.length === 0) {
    encoded.id = randomUUID();
  }
  let emailHmac: string | null = null;

  if (modelKey === "user") {
    const rawEmail = typeof encoded.email === "string" ? encoded.email : "";
    const encryptedFields = codec.encryptUserEmail(rawEmail);
    encoded.emailCiphertext = encryptedFields.emailCiphertext;
    encoded.emailHash = encryptedFields.emailHash;
    encoded.keyVersion = encryptedFields.keyVersion;
    emailHmac = encryptedFields.emailHash;
    delete encoded.email;
    delete encoded.name;
    delete encoded.image;
  } else if (modelKey === "verification") {
    if (typeof encoded.identifier === "string") {
      emailHmac = extractEmailHmacFromIdentifier(encoded.identifier, codec);
      encoded.identifier = transformVerificationIdentifier(encoded.identifier, codec);
    }
    if (typeof encoded.value === "string") {
      const embeddedEmail = extractEmailFromVerificationValue(encoded.value);
      if (embeddedEmail !== null && emailHmac === null) {
        emailHmac = codec.computeEmailHmac(embeddedEmail);
      }
      encoded.value = codec.encryptVerificationPayload(encoded.value);
    }
  } else if (modelKey === "account") {
    encodeAccountTokens(encoded, codec);
  } else if (modelKey === "session") {
    delete encoded.ipAddress;
  } else if (modelKey === "rateLimit" && typeof encoded.key === "string") {
    encoded.key = encodeRateLimitKey(encoded.key, codec);
  }
  return { encoded, emailHmac };
}

export function encodeUpdateData(model: string, update: Record<string, unknown>, codec: AuthCryptoCodec): Record<string, unknown> {
  const modelKey = normalizeModelKey(model);
  const encoded: Record<string, unknown> = { ...update };
  if (modelKey === "user") {
    if (typeof encoded.email === "string") {
      const encryptedFields = codec.encryptUserEmail(encoded.email);
      encoded.emailCiphertext = encryptedFields.emailCiphertext;
      encoded.emailHash = encryptedFields.emailHash;
      encoded.keyVersion = encryptedFields.keyVersion;
    }
    delete encoded.email;
    delete encoded.name;
    delete encoded.image;
  } else if (modelKey === "verification") {
    if (typeof encoded.identifier === "string") {
      encoded.identifier = transformVerificationIdentifier(encoded.identifier, codec);
    }
    if (typeof encoded.value === "string") {
      encoded.value = codec.encryptVerificationPayload(encoded.value);
    }
  } else if (modelKey === "account") {
    encodeAccountTokens(encoded, codec);
  } else if (modelKey === "session") {
    delete encoded.ipAddress;
  }
  return encoded;
}

function readRowCiphertext(row: Record<string, unknown>): string | null {
  if (typeof row.emailCiphertext === "string") {
    return row.emailCiphertext;
  }
  if (typeof row.email_ciphertext === "string") {
    return row.email_ciphertext;
  }
  return null;
}

function readRowKeyVersion(row: Record<string, unknown>): number {
  if (typeof row.keyVersion === "number") {
    return row.keyVersion;
  }
  if (typeof row.key_version === "number") {
    return row.key_version;
  }
  return 1;
}

export function decodeDatabaseRow(
  model: string,
  row: Record<string, unknown> | null | undefined,
  codec: AuthCryptoCodec,
): Record<string, unknown> | null {
  if (!row) {
    return null;
  }
  const modelKey = normalizeModelKey(model);
  const nextRow: Record<string, unknown> = { ...row };

  if (modelKey === "user") {
    const ciphertext = readRowCiphertext(nextRow);
    const keyVersion = readRowKeyVersion(nextRow);
    if (ciphertext !== null) {
      const decryptedEmail = codec.decryptUserEmail(ciphertext, keyVersion);
      nextRow.email = decryptedEmail;
      nextRow.name = typeof nextRow.handle === "string" && nextRow.handle.length > 0 ? nextRow.handle : (decryptedEmail.split("@")[0] ?? "user");
      nextRow.image = null;
    }
    delete nextRow.emailCiphertext;
    delete nextRow.email_ciphertext;
    delete nextRow.emailHash;
    delete nextRow.email_hash;
  } else if ((modelKey === "session" || modelKey === "account") && nextRow.user && typeof nextRow.user === "object") {
    nextRow.user = decodeDatabaseRow("user", nextRow.user as Record<string, unknown>, codec);
  } else if (modelKey === "verification" && typeof nextRow.value === "string" && nextRow.value.startsWith("v")) {
    nextRow.value = codec.decryptVerificationPayload(nextRow.value);
  } else if (modelKey === "rateLimit") {
    const rawLastRequest = nextRow.lastRequest ?? nextRow.last_request;
    if (typeof rawLastRequest === "string" || typeof rawLastRequest === "bigint") {
      nextRow.lastRequest = Number(rawLastRequest);
    }
  }
  return nextRow;
}
