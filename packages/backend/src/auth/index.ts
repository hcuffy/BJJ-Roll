export { createEncryptedRlsAuthAdapter, type CreateEncryptedRlsAuthAdapterOptions } from "./authAdapter.js";
export { createMagicLinkExchangePlugin, type CreateMagicLinkExchangePluginOptions } from "./authExchangePlugin.js";
export {
  DEEP_LINK_CALLBACK_URL,
  DEEP_LINK_SCHEME,
  MAGIC_LINK_EXCHANGE_CODE_EXPIRY_SECONDS,
  MAGIC_LINK_EXPIRY_MINUTES,
  MAGIC_LINK_EXPIRY_SECONDS,
  MAX_SENDS_PER_EMAIL_PER_WINDOW,
  MAX_SENDS_PER_IP_PER_WINDOW,
  MAX_VERIFIES_PER_IP_PER_WINDOW,
  OTP_EXPIRY_MINUTES,
  OTP_EXPIRY_SECONDS,
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  RATE_LIMIT_WINDOW_SECONDS,
  SESSION_ABSOLUTE_MAX_LIFETIME_DAYS,
  SESSION_ABSOLUTE_MAX_LIFETIME_SECONDS,
  SESSION_SLIDING_EXPIRY_DAYS,
  SESSION_SLIDING_EXPIRY_SECONDS,
  SESSION_UPDATE_AGE_DAYS,
  SESSION_UPDATE_AGE_SECONDS,
} from "./authLimits.js";
export { authIpRateLimitCustomRules, enforcePerEmailSendRateLimit, ensureAuthRateLimitsTable } from "./authRateLimits.js";
export {
  AUTH_DATA_ENCRYPTION_KEY_ENV,
  AUTH_EMAIL_HMAC_KEY_ENV,
  createAuthCryptoCodec,
  generateCsprngOtpCode,
  generateTestAuthSecrets,
  loadAuthKeyringFromEnvironment,
  type AuthCryptoCodec,
  type AuthSecretEnvironment,
} from "./authSecrets.js";
export { createAuth, mountAuthRoutes, type AuthInstance, type CreateAuthOptions } from "./createAuth.js";
