import { EmailSendError } from "../email/index.js";

/**
 * HEN-263 (Sara, 26 Oct): a sign-in email is queued, not awaited, so the response to a send never waits on the mail provider
 * and a known and an unknown email take the same path back. A failure is logged with its reason only (no address, no code).
 */
export function enqueueSignInEmail(send: () => Promise<void>): void {
  void (async () => {
    try {
      await send();
    } catch (error) {
      process.stdout.write(
        `${JSON.stringify({ event: "sign_in_email_failed", reason: error instanceof EmailSendError ? error.reason : "unknown" })}\n`,
      );
    }
  })();
}
