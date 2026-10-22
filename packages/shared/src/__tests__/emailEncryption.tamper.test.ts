import { describe, expect, it } from "vitest";
import { decryptEmail, EmailDecryptionError, type EncryptedEmail, encryptEmail, type Keyring } from "../encryption/index.js";
import { createTestKeyring, sampleEmail } from "./encryptionTestKeys.js";

function flipFirstByte(bytes: Buffer): Buffer {
  const copy = Buffer.from(bytes);
  copy[0] = (copy[0] ?? 0) ^ 0xff;
  return copy;
}

function decryptionErrorOf(keyring: Keyring, encrypted: EncryptedEmail): unknown {
  try {
    decryptEmail(keyring, encrypted);
  } catch (error) {
    return error;
  }
  throw new Error("expected decryption to fail");
}

describe("tamper and wrong key rejection (HEN-63 AC 5)", () => {
  const keyring = createTestKeyring();
  const encrypted = encryptEmail(keyring, sampleEmail);

  it.each([
    { part: "ciphertext", changed: { ...encrypted, ciphertext: flipFirstByte(encrypted.ciphertext) } },
    { part: "nonce", changed: { ...encrypted, nonce: flipFirstByte(encrypted.nonce) } },
    { part: "auth tag", changed: { ...encrypted, authTag: flipFirstByte(encrypted.authTag) } },
    { part: "truncated auth tag", changed: { ...encrypted, authTag: encrypted.authTag.subarray(0, 8) } },
    { part: "unknown key version", changed: { ...encrypted, keyVersion: 99 } },
  ])("rejects a changed $part", ({ changed }) => {
    expect(() => decryptEmail(keyring, changed)).toThrow(EmailDecryptionError);
  });

  it("fails with the wrong key", () => {
    expect(() => decryptEmail(createTestKeyring(), encrypted)).toThrow(EmailDecryptionError);
  });

  it("never puts plaintext or key bytes in the error", () => {
    const keyBytes = keyring.dataKeyFor(1);
    const hmacKeyBytes = keyring.hmacKey();
    const errors = [
      decryptionErrorOf(createTestKeyring(), encrypted),
      decryptionErrorOf(keyring, { ...encrypted, authTag: flipFirstByte(encrypted.authTag) }),
    ];
    for (const error of errors) {
      const rendered = `${String(error)} ${JSON.stringify(error)} ${(error as Error).stack ?? ""}`;
      expect(rendered).not.toContain(sampleEmail);
      for (const secret of [keyBytes, hmacKeyBytes]) {
        expect(rendered).not.toContain(secret.toString("hex"));
        expect(rendered).not.toContain(secret.toString("base64"));
      }
      expect((error as Error).cause).toBeUndefined();
    }
  });

  it("does not show key bytes when a keyring is serialised", () => {
    expect(JSON.stringify(keyring)).not.toContain(keyring.dataKeyFor(1).toString("hex"));
    expect(JSON.stringify(keyring)).toBe('{"currentKeyVersion":1}');
  });
});
