/**
 * Authentication rate limits, token lifetimes, and session window constants (HEN-71).
 */

// HEN-71 spec (Sara 2026-10-22): 6-digit OTP code length
export const OTP_LENGTH = 6;

// HEN-71 spec (Sara 2026-10-22): 10-minute (600s) OTP expiry
export const OTP_EXPIRY_MINUTES = 10;
export const OTP_EXPIRY_SECONDS = OTP_EXPIRY_MINUTES * 60;

// HEN-71 spec (Sara 2026-10-22): maximum 5 verification attempts per OTP before the code is burned
export const OTP_MAX_ATTEMPTS = 5;

// HEN-71 spec (Sara 2026-10-22): 15-minute (900s) magic-link token expiry
export const MAGIC_LINK_EXPIRY_MINUTES = 15;
export const MAGIC_LINK_EXPIRY_SECONDS = MAGIC_LINK_EXPIRY_MINUTES * 60;

// HEN-71 spec (Sara 2026-10-22): 60-second one-time deep-link exchange code expiry
export const MAGIC_LINK_EXCHANGE_CODE_EXPIRY_SECONDS = 60;

// Deep-link URL scheme and default callback URL for M2 mobile auth (App/Universal Links deferred to M4 / HEN-50)
export const DEEP_LINK_SCHEME = "bjjroll";
export const DEEP_LINK_CALLBACK_URL = `${DEEP_LINK_SCHEME}://auth/callback`;

// HEN-71 spec (Sara 2026-10-22): 15-minute (900s) rate-limit window
export const RATE_LIMIT_WINDOW_SECONDS = 15 * 60;

// HEN-71 spec (Sara 2026-10-22): 3 OTP/magic-link sends per email per 15 minutes
export const MAX_SENDS_PER_EMAIL_PER_WINDOW = 3;

// HEN-71 spec (Sara 2026-10-22): 10 OTP/magic-link sends per IP per 15 minutes
export const MAX_SENDS_PER_IP_PER_WINDOW = 10;

// HEN-71 spec (Sara 2026-10-22): 20 verification attempts per IP per 15 minutes
export const MAX_VERIFIES_PER_IP_PER_WINDOW = 20;

// HEN-71 spec (Sara 2026-10-22): 30-day sliding session window, refreshed at most once per 1-day updateAge
export const SESSION_SLIDING_EXPIRY_DAYS = 30;
export const SESSION_SLIDING_EXPIRY_SECONDS = SESSION_SLIDING_EXPIRY_DAYS * 24 * 60 * 60;
export const SESSION_UPDATE_AGE_DAYS = 1;
export const SESSION_UPDATE_AGE_SECONDS = SESSION_UPDATE_AGE_DAYS * 24 * 60 * 60;

// HEN-71 spec (Sara 2026-10-22): 90-day absolute maximum session lifetime from initial creation
export const SESSION_ABSOLUTE_MAX_LIFETIME_DAYS = 90;
export const SESSION_ABSOLUTE_MAX_LIFETIME_SECONDS = SESSION_ABSOLUTE_MAX_LIFETIME_DAYS * 24 * 60 * 60;
