import { describe, expect, it } from "vitest";
import { createKeyring, decryptEmail, emailLookupHash, encryptEmail } from "../encryption/index.js";
import { generateTestKey, sampleEmail } from "./encryptionTestKeys.js";

describe("key rotation by key_version (HEN-63 AC 4)", () => {
  const versionOneKey = generateTestKey();
  const versionTwoKey = generateTestKey();
  const hmacKey = generateTestKey();
  const versionOneKeyring = createKeyring({ dataKeys: [{ keyVersion: 1, key: versionOneKey }], hmacKey, currentKeyVersion: 1 });
  const rotatedKeyring = createKeyring({
    dataKeys: [
      { keyVersion: 1, key: versionOneKey },
      { keyVersion: 2, key: versionTwoKey },
    ],
    hmacKey,
    currentKeyVersion: 2,
  });

  it("still decrypts data written under version 1 after version 2 becomes current", () => {
    const writtenUnderVersionOne = encryptEmail(versionOneKeyring, sampleEmail);
    expect(writtenUnderVersionOne.keyVersion).toBe(1);
    expect(decryptEmail(rotatedKeyring, writtenUnderVersionOne)).toBe(sampleEmail);
  });

  it("writes new data under version 2", () => {
    const written = encryptEmail(rotatedKeyring, sampleEmail);
    expect(written.keyVersion).toBe(2);
    expect(decryptEmail(rotatedKeyring, written)).toBe(sampleEmail);
  });

  it("keeps the lookup hash stable across data key rotation", () => {
    expect(emailLookupHash(rotatedKeyring, sampleEmail).equals(emailLookupHash(versionOneKeyring, sampleEmail))).toBe(true);
  });
});
