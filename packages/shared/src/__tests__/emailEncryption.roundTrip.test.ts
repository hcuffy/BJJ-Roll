import { describe, expect, it } from "vitest";
import { decryptEmail, encryptEmail } from "../encryption/index.js";
import { createTestKeyring, sampleEmail } from "./encryptionTestKeys.js";

describe("encryptEmail / decryptEmail round trip (HEN-63 AC 1–2)", () => {
  it("returns the original email", () => {
    const keyring = createTestKeyring();
    expect(decryptEmail(keyring, encryptEmail(keyring, sampleEmail))).toBe(sampleEmail);
  });

  it("uses a fresh 12-byte nonce, so two encryptions of one email differ", () => {
    const keyring = createTestKeyring();
    const first = encryptEmail(keyring, sampleEmail);
    const second = encryptEmail(keyring, sampleEmail);
    expect(first.nonce).toHaveLength(12);
    expect(second.nonce).toHaveLength(12);
    expect(first.nonce.equals(second.nonce)).toBe(false);
    expect(first.ciphertext.equals(second.ciphertext)).toBe(false);
  });

  it("does not contain the plaintext in the ciphertext", () => {
    const keyring = createTestKeyring();
    const encrypted = encryptEmail(keyring, sampleEmail);
    expect(encrypted.ciphertext.toString("utf8")).not.toContain(sampleEmail);
    expect(encrypted.authTag).toHaveLength(16);
  });
});
