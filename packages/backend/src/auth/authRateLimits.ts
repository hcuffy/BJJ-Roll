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
import { currentMs } from "../dates.js";

export interface RateLimitRuleConfig {
  readonly window: number;
  readonly max: number;
}

export const authIpRateLimitCustomRules: Record<string, RateLimitRuleConfig> = {
  "/email-otp/send-verification-otp": {
    window: RATE_LIMIT_WINDOW_SECONDS,
    max: MAX_SENDS_PER_IP_PER_WINDOW,
  },
  "/sign-in/magic-link": {
    window: RATE_LIMIT_WINDOW_SECONDS,
    max: MAX_SENDS_PER_IP_PER_WINDOW,
  },
  "/sign-in/social": {
    window: RATE_LIMIT_WINDOW_SECONDS,
    max: MAX_VERIFIES_PER_IP_PER_WINDOW,
  },
  "/callback/*": {
    window: RATE_LIMIT_WINDOW_SECONDS,
    max: MAX_VERIFIES_PER_IP_PER_WINDOW,
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

export function emailRateLimitKey(emailHmac: string): string {
  return `email:${emailHmac}`;
}

export async function incrementRateLimitCounter(pool: Pool, key: string, windowSeconds: number): Promise<number> {
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
      [randomUUID(), key, currentMs(), windowSeconds * 1000],
    );
    await client.query("COMMIT");
    return result.rows[0]?.count ?? 1;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function resetRateLimitCounter(pool: Pool, key: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE bjj_app");
    await client.query("DELETE FROM public.rate_limits WHERE key = $1", [key]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function enforcePerEmailSendRateLimit(pool: Pool, codec: AuthCryptoCodec, rawEmail: string): Promise<void> {
  const rateLimitKey = emailRateLimitKey(codec.computeEmailHmac(rawEmail));
  const currentCount = await incrementRateLimitCounter(pool, rateLimitKey, RATE_LIMIT_WINDOW_SECONDS);
  if (currentCount > MAX_SENDS_PER_EMAIL_PER_WINDOW) {
    throw new APIError("TOO_MANY_REQUESTS", {
      message: "Too many verification emails requested for this address. Please try again later.",
    });
  }
}
