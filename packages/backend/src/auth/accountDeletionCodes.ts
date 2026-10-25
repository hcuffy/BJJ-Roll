/**
 * The fresh email code DELETE /account needs (HEN-65, Henry 25 Oct).
 * It reuses Better Auth's email-OTP machinery: the same CSPRNG code, keyed hash at rest, 10-minute expiry,
 * attempt budget and per-email send limit as sign-in codes. It lives under the "email-verification" OTP type,
 * which the app uses for nothing else, so a sign-in code can never delete an account.
 */
export const ACCOUNT_DELETION_OTP_TYPE = "email-verification";

export type AccountDeletionCodeSendResult = "sent" | "rate_limited";
export type AccountDeletionCodeCheckResult = "valid" | "invalid";

export interface AccountDeletionCodes {
  /** Emails a new code to this address; a newer code replaces any older one. */
  send(email: string): Promise<AccountDeletionCodeSendResult>;
  /** Wrong, expired, superseded or burned codes are all "invalid". A wrong try spends one attempt. */
  check(email: string, code: string): Promise<AccountDeletionCodeCheckResult>;
}

/** The two server-side Better Auth email-OTP calls this needs. */
export interface EmailOtpServerApi {
  sendVerificationOTP(input: { body: { email: string; type: typeof ACCOUNT_DELETION_OTP_TYPE } }): Promise<unknown>;
  checkVerificationOTP(input: { body: { email: string; type: typeof ACCOUNT_DELETION_OTP_TYPE; otp: string } }): Promise<unknown>;
}

function statusCodeOf(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "statusCode" in error) {
    const { statusCode } = error as { statusCode?: unknown };
    return typeof statusCode === "number" ? statusCode : undefined;
  }
  return undefined;
}

export function createAccountDeletionCodes(api: EmailOtpServerApi): AccountDeletionCodes {
  return {
    async send(email) {
      try {
        await api.sendVerificationOTP({ body: { email, type: ACCOUNT_DELETION_OTP_TYPE } });
        return "sent";
      } catch (error) {
        if (statusCodeOf(error) === 429) {
          return "rate_limited";
        }
        throw error;
      }
    },
    async check(email, code) {
      try {
        await api.checkVerificationOTP({ body: { email, type: ACCOUNT_DELETION_OTP_TYPE, otp: code } });
        return "valid";
      } catch (error) {
        const statusCode = statusCodeOf(error);
        if (statusCode === 400 || statusCode === 403) {
          return "invalid";
        }
        throw error;
      }
    },
  };
}
