import { randomBytes } from "node:crypto";
import { createKeyring, ENCRYPTION_KEY_BYTES, type Keyring } from "../encryption/index.js";

/** Fresh random key generated at test time. No key is ever stored in the repo. */
export function generateTestKey(): Buffer {
  return randomBytes(ENCRYPTION_KEY_BYTES);
}

export function createTestKeyring(): Keyring {
  return createKeyring({ dataKeys: [{ keyVersion: 1, key: generateTestKey() }], hmacKey: generateTestKey(), currentKeyVersion: 1 });
}

export const sampleEmail = "grappler@example.com";
