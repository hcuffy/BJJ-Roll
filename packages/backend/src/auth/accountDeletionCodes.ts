const ACCOUNT_DELETION_OTP_TYPE = "email-verification";

type AccountDeletionCodeSendResult = "sent" | "rate_limited";
type AccountDeletionCodeCheckResult = "valid" | "invalid";

export interface AccountDeletionCodes {
  send(email: string): Promise<AccountDeletionCodeSendResult>;
  check(email: string, code: string): Promise<AccountDeletionCodeCheckResult>;
}

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
