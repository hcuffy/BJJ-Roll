import type { Pool } from "pg";
import { MAX_VERIFIES_PER_IP_PER_WINDOW, OTP_MAX_ATTEMPTS, RATE_LIMIT_WINDOW_SECONDS } from "./authLimits.js";
import { incrementRateLimitCounter, resetRateLimitCounter } from "./authRateLimits.js";

/**
 * The try budget in front of every DELETE /account code check (HEN-65, Bill's gate @ a4ce80f).
 * Each try is counted with one atomic upsert before the code is checked, so parallel guesses cannot share a stale count
 * the way they can inside Better Auth's check (read, then write). Per user: OTP_MAX_ATTEMPTS tries per code, reset when a
 * new code is sent. The 15-minute window outlives the 10-minute code, so one code never gets more tries. Per IP: the auth verify limit.
 */
export interface AccountDeletionAttempts {
  /** Counts one try for this user and client IP; "rate_limited" when either budget is spent (the code is then not checked). */
  take(userId: string, clientIp: string): Promise<"allowed" | "rate_limited">;
  /** A new code went out: the user's tries start again. The per-IP count does not. */
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
