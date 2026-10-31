import { randomBytes } from "node:crypto";
import { createKeyring, ENCRYPTION_KEY_BYTES, type Keyring } from "../encryption/index.js";

export function generateTestKey(): Buffer {
  return randomBytes(ENCRYPTION_KEY_BYTES);
}

export function createTestKeyring(): Keyring {
  return createKeyring({ dataKeys: [{ keyVersion: 1, key: generateTestKey() }], hmacKey: generateTestKey(), currentKeyVersion: 1 });
}

export const sampleEmail = "grappler@example.com";
