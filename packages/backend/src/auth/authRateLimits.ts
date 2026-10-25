import { randomUUID } from "node:crypto";
import { APIError } from "better-auth/api";
import type { Pool } from "pg";
import {
  MAX_SENDS_PER_EMAIL_PER_WINDOW,
  MAX_SENDS_PER_IP_PER_WINDOW,
  MAX_VERIFIES_PER_IP_PER_WINDOW,
  RATE_LIMIT_WINDOW_SECONDS,
} from "./authLimits.js";
import type { AuthCryptoCodec } from "./authSecrets.js";
import { emailRateLimitKey } from "../database/cascadeDelete.js";

export interface RateLimitRuleConfig {
  readonly window: number;
  readonly max: number;
}

/**
 * Better Auth per-IP rate-limit rules backed by `public.rate_limits` in PostgreSQL (HEN-71 AC 5).
 */
export const authIpRateLimitCustomRules: Record<string, RateLimitRuleConfig> = {
  "/email-otp/send-verification-otp": {
    window: RATE_LIMIT_WINDOW_SECONDS,
    max: MAX_SENDS_PER_IP_PER_WINDOW,
  },
  "/sign-in/magic-link": {
    window: RATE_LIMIT_WINDOW_SECONDS,
    max: MAX_SENDS_PER_IP_PER_WINDOW,
  },
  "/sign-in/email-otp": {
    window: RATE_LIMIT_WINDOW_SECONDS,
    max: MAX_VERIFIES_PER_IP_PER_WINDOW,
  },
  "/email-otp/verify-email": {
    window: RATE_LIMIT_WINDOW_SECONDS,
    max: MAX_VERIFIES_PER_IP_PER_WINDOW,
  },
  "/email-otp/check-verification-otp": {
    window: RATE_LIMIT_WINDOW_SECONDS,
    max: MAX_VERIFIES_PER_IP_PER_WINDOW,
  },
  "/magic-link/verify": {
    window: RATE_LIMIT_WINDOW_SECONDS,
    max: MAX_VERIFIES_PER_IP_PER_WINDOW,
  },
  "/magic-link/exchange": {
    window: RATE_LIMIT_WINDOW_SECONDS,
    max: MAX_VERIFIES_PER_IP_PER_WINDOW,
  },
};

/**
 * Enforces the Postgres-backed 3 sends / email / 15 minutes rate limit using the keyed email HMAC (never plaintext email).
 * Fixed window from the first send; `public.rate_limits` comes from migration 002 (no runtime DDL).
 */
export async function enforcePerEmailSendRateLimit(pool: Pool, codec: AuthCryptoCodec, rawEmail: string): Promise<void> {
  const emailHmac = codec.computeEmailHmac(rawEmail);
  const rateLimitKey = emailRateLimitKey(emailHmac);
  const nowMilliseconds = Date.now();
  const windowMilliseconds = RATE_LIMIT_WINDOW_SECONDS * 1000;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE bjj_app");
    const result = await client.query<{ count: number }>(
      `INSERT INTO public.rate_limits (id, key, count, last_request)
       VALUES ($1, $2, 1, $3)
       ON CONFLICT (key) DO UPDATE SET
         count = CASE
           WHEN $3 - public.rate_limits.last_request >= $4 THEN 1
           ELSE public.rate_limits.count + 1
         END,
         last_request = CASE
           WHEN $3 - public.rate_limits.last_request >= $4 THEN $3
           ELSE public.rate_limits.last_request
         END
       RETURNING count`,
      [randomUUID(), rateLimitKey, nowMilliseconds, windowMilliseconds],
    );
    await client.query("COMMIT");

    const currentCount = result.rows[0]?.count ?? 1;
    if (currentCount > MAX_SENDS_PER_EMAIL_PER_WINDOW) {
      throw new APIError("TOO_MANY_REQUESTS", {
        message: "Too many verification emails requested for this address. Please try again later.",
      });
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
