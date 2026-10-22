// Server-only. Import as `@bjj-roll/shared/encryption`; never re-export from `src/index.ts` (uses `node:crypto`).
export { decryptEmail, EmailDecryptionError, emailLookupHash, encryptEmail, ENCRYPTION_MODULE_MARKER, normalizeEmail } from "./emailEncryption.js";
export type { EncryptedEmail } from "./emailEncryption.js";
export { createKeyring, ENCRYPTION_KEY_BYTES, KeyringError } from "./keyring.js";
export type { DataKeyEntry, Keyring, KeyringInput } from "./keyring.js";
