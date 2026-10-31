import type { Pool } from "pg";
import { MAX_VERIFIES_PER_IP_PER_WINDOW, OTP_MAX_ATTEMPTS, RATE_LIMIT_WINDOW_SECONDS } from "./authLimits.js";
import { incrementRateLimitCounter, resetRateLimitCounter } from "./authRateLimits.js";

export interface AccountDeletionAttempts {
  take(userId: string, clientIp: string): Promise<"allowed" | "rate_limited">;
  resetForNewCode(userId: string): Promise<void>;
}

const userKey = (userId: string): string => `account-delete:user:${userId}`;
const ipKey = (clientIp: string): string => `account-delete:ip:${clientIp}`;

export function createAccountDeletionAttempts(pool: Pool): AccountDeletionAttempts {
  return {
    async take(userId, clientIp) {
      const [userCount, ipCount] = await Promise.all([
        incrementRateLimitCounter(pool, userKey(userId), RATE_LIMIT_WINDOW_SECONDS),
        incrementRateLimitCounter(pool, ipKey(clientIp), RATE_LIMIT_WINDOW_SECONDS),
      ]);
      return userCount > OTP_MAX_ATTEMPTS || ipCount > MAX_VERIFIES_PER_IP_PER_WINDOW ? "rate_limited" : "allowed";
    },
    resetForNewCode(userId) {
      return resetRateLimitCounter(pool, userKey(userId));
    },
  };
}
