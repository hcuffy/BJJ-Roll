import { timingSafeEqual } from "node:crypto";

/** Key length in bytes for both the AES-256-GCM data keys and the HMAC-SHA256 key. */
export const ENCRYPTION_KEY_BYTES = 32;

export interface DataKeyEntry {
  keyVersion: number;
  key: Uint8Array;
}

export interface KeyringInput {
  dataKeys: readonly DataKeyEntry[];
  hmacKey: Uint8Array;
  currentKeyVersion: number;
}

/** Holds the keys in a closure, so logging or serialising a keyring never shows key bytes. */
export interface Keyring {
  readonly currentKeyVersion: number;
  dataKeyFor(keyVersion: number): Buffer;
  hmacKey(): Buffer;
}

export class KeyringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyringError";
  }
}

function assertKeyLength(key: Uint8Array, label: string): void {
  if (key.byteLength !== ENCRYPTION_KEY_BYTES) {
    throw new KeyringError(`${label} must be ${ENCRYPTION_KEY_BYTES} bytes`);
  }
}

function assertKeyVersion(keyVersion: number): void {
  if (!Number.isSafeInteger(keyVersion) || keyVersion < 1) {
    throw new KeyringError("Key version must be a positive integer");
  }
}

/** Builds a keyring from keys the caller supplies. This module never reads environment variables. */
export function createKeyring(input: KeyringInput): Keyring {
  const hmacKey = Buffer.from(input.hmacKey);
  assertKeyLength(hmacKey, "HMAC key");
  const dataKeys = new Map<number, Buffer>();
  for (const entry of input.dataKeys) {
    assertKeyVersion(entry.keyVersion);
    const key = Buffer.from(entry.key);
    assertKeyLength(key, "Data key");
    if (timingSafeEqual(key, hmacKey)) {
      throw new KeyringError("HMAC key must differ from every data key");
    }
    if (dataKeys.has(entry.keyVersion)) {
      throw new KeyringError("Key versions must be unique");
    }
    dataKeys.set(entry.keyVersion, key);
  }
  assertKeyVersion(input.currentKeyVersion);
  if (!dataKeys.has(input.currentKeyVersion)) {
    throw new KeyringError("Current key version has no data key");
  }
  return {
    currentKeyVersion: input.currentKeyVersion,
    dataKeyFor(keyVersion: number): Buffer {
      const key = dataKeys.get(keyVersion);
      if (key === undefined) {
        throw new KeyringError("Unknown key version");
      }
      return key;
    },
    hmacKey(): Buffer {
      return hmacKey;
    },
  };
}
