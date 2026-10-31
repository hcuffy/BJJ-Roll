import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

const initializationVectorLength = 12;
const authenticationTagLength = 16;

export interface EmailProtection {
  hashEmail: (email: string) => string;
  hashSecret: (value: string) => string;
  encrypt: (plaintext: string) => string;
  decrypt: (ciphertext: string) => string;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function createEmailProtection(): EmailProtection {
  const dataKey = randomBytes(32);
  const hmacKey = randomBytes(32);
  const hmacHex = (value: string) => createHmac("sha256", hmacKey).update(value).digest("hex");

  return {
    hashEmail: (email) => hmacHex(normalizeEmail(email)),
    hashSecret: (value) => hmacHex(`secret:${value}`),
    encrypt: (plaintext) => {
      const initializationVector = randomBytes(initializationVectorLength);
      const cipher = createCipheriv("aes-256-gcm", dataKey, initializationVector);
      const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      return Buffer.concat([initializationVector, cipher.getAuthTag(), encrypted]).toString("base64");
    },
    decrypt: (ciphertext) => {
      const packed = Buffer.from(ciphertext, "base64");
      const initializationVector = packed.subarray(0, initializationVectorLength);
      const authenticationTag = packed.subarray(initializationVectorLength, initializationVectorLength + authenticationTagLength);
      const decipher = createDecipheriv("aes-256-gcm", dataKey, initializationVector);
      decipher.setAuthTag(authenticationTag);
      const encrypted = packed.subarray(initializationVectorLength + authenticationTagLength);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    },
  };
}
