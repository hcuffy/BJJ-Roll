import { describe, expect, it } from "vitest";
import { createKeyring, emailLookupHash } from "../encryption/index.js";
import { generateTestKey } from "./encryptionTestKeys.js";

describe("emailLookupHash (HEN-63 AC 3)", () => {
  const dataKey = generateTestKey();
  const hmacKey = generateTestKey();
  const keyring = createKeyring({ dataKeys: [{ keyVersion: 1, key: dataKey }], hmacKey, currentKeyVersion: 1 });

  it("hashes lower(trim(email)), so case and spaces do not matter", () => {
    expect(emailLookupHash(keyring, " Foo@Example.com ").equals(emailLookupHash(keyring, "foo@example.com"))).toBe(true);
  });

  it("is a 32-byte HMAC-SHA256 that differs per email", () => {
    const hash = emailLookupHash(keyring, "foo@example.com");
    expect(hash).toHaveLength(32);
    expect(hash.equals(emailLookupHash(keyring, "bar@example.com"))).toBe(false);
  });

  it("uses the HMAC key, not the data key", () => {
    const sameDataKeyOtherHmacKey = createKeyring({ dataKeys: [{ keyVersion: 1, key: dataKey }], hmacKey: generateTestKey(), currentKeyVersion: 1 });
    expect(emailLookupHash(keyring, "foo@example.com").equals(emailLookupHash(sameDataKeyOtherHmacKey, "foo@example.com"))).toBe(false);
  });
});
