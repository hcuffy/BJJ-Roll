import type { Pool } from "pg";
import { HANDLE_AVAILABILITY_WINDOW_SECONDS, MAX_HANDLE_AVAILABILITY_CHECKS_PER_IP_PER_WINDOW } from "./authLimits.js";
import { incrementRateLimitCounter } from "./authRateLimits.js";
import type { AuthCryptoCodec } from "./authSecrets.js";

export interface HandleAvailabilityAttempts {
  take(clientIp: string): Promise<"allowed" | "rate_limited">;
}

export function createHandleAvailabilityAttempts(pool: Pool, codec: AuthCryptoCodec): HandleAvailabilityAttempts {
  return {
    async take(clientIp) {
      const count = await incrementRateLimitCounter(
        pool,
        `handle-availability:ip:${codec.hashClientIp(clientIp)}`,
        HANDLE_AVAILABILITY_WINDOW_SECONDS,
      );
      return count > MAX_HANDLE_AVAILABILITY_CHECKS_PER_IP_PER_WINDOW ? "rate_limited" : "allowed";
    },
  };
}
