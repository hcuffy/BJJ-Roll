import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import type { Keyring } from "./keyring.js";

export const ENCRYPTION_MODULE_MARKER = "bjj-roll-encryption-v1";

const CIPHER_ALGORITHM = "aes-256-gcm";
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export interface EncryptedEmail {
  keyVersion: number;
  nonce: Buffer;
  ciphertext: Buffer;
  authTag: Buffer;
}

export class EmailDecryptionError extends Error {
  constructor() {
    super("Email decryption failed");
    this.name = "EmailDecryptionError";
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function encryptEmail(keyring: Keyring, email: string): EncryptedEmail {
  const keyVersion = keyring.currentKeyVersion;
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(CIPHER_ALGORITHM, keyring.dataKeyFor(keyVersion), nonce, { authTagLength: AUTH_TAG_BYTES });
  cipher.setAAD(Buffer.from(ENCRYPTION_MODULE_MARKER, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(email, "utf8"), cipher.final()]);
  return { keyVersion, nonce, ciphertext, authTag: cipher.getAuthTag() };
}

export function decryptEmail(keyring: Keyring, encrypted: EncryptedEmail): string {
  try {
    if (encrypted.nonce.byteLength !== NONCE_BYTES || encrypted.authTag.byteLength !== AUTH_TAG_BYTES) {
      throw new EmailDecryptionError();
    }
    const decipher = createDecipheriv(CIPHER_ALGORITHM, keyring.dataKeyFor(encrypted.keyVersion), encrypted.nonce, {
      authTagLength: AUTH_TAG_BYTES,
    });
    decipher.setAAD(Buffer.from(ENCRYPTION_MODULE_MARKER, "utf8"));
    decipher.setAuthTag(encrypted.authTag);
    return Buffer.concat([decipher.update(encrypted.ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new EmailDecryptionError();
  }
}

export function emailLookupHash(keyring: Keyring, email: string): Buffer {
  return createHmac("sha256", keyring.hmacKey()).update(normalizeEmail(email), "utf8").digest();
}
