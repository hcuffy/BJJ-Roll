import { describe, expect, it } from "vitest";
import { createKeyring, KeyringError } from "../encryption/index.js";
import { generateTestKey } from "./encryptionTestKeys.js";

describe("createKeyring validation (HEN-63 AC 8)", () => {
  it("refuses an HMAC key with the same bytes as a data key", () => {
    const sharedKey = generateTestKey();
    expect(() =>
      createKeyring({
        dataKeys: [
          { keyVersion: 1, key: generateTestKey() },
          { keyVersion: 2, key: Buffer.from(sharedKey) },
        ],
        hmacKey: sharedKey,
        currentKeyVersion: 2,
      }),
    ).toThrow(KeyringError);
  });

  it.each([16, 31, 33, 64])("refuses a %i-byte data key", (length) => {
    expect(() =>
      createKeyring({ dataKeys: [{ keyVersion: 1, key: Buffer.alloc(length, 1) }], hmacKey: generateTestKey(), currentKeyVersion: 1 }),
    ).toThrow(KeyringError);
  });

  it.each([0, 16, 31, 33])("refuses a %i-byte HMAC key", (length) => {
    expect(() =>
      createKeyring({ dataKeys: [{ keyVersion: 1, key: generateTestKey() }], hmacKey: Buffer.alloc(length, 1), currentKeyVersion: 1 }),
    ).toThrow(KeyringError);
  });

  it("refuses a current version with no data key, a duplicate version and a non-positive version", () => {
    const hmacKey = generateTestKey();
    expect(() => createKeyring({ dataKeys: [{ keyVersion: 1, key: generateTestKey() }], hmacKey, currentKeyVersion: 2 })).toThrow(KeyringError);
    expect(() =>
      createKeyring({
        dataKeys: [
          { keyVersion: 1, key: generateTestKey() },
          { keyVersion: 1, key: generateTestKey() },
        ],
        hmacKey,
        currentKeyVersion: 1,
      }),
    ).toThrow(KeyringError);
    expect(() => createKeyring({ dataKeys: [{ keyVersion: 0, key: generateTestKey() }], hmacKey, currentKeyVersion: 0 })).toThrow(KeyringError);
  });

  it("builds with valid, distinct 32-byte keys", () => {
    expect(
      createKeyring({ dataKeys: [{ keyVersion: 1, key: generateTestKey() }], hmacKey: generateTestKey(), currentKeyVersion: 1 }).currentKeyVersion,
    ).toBe(1);
  });
});
