import { setTimeout as sleep } from "node:timers/promises";
import { EmailSendError } from "../email/index.js";

/** Tries per sign-in email, the first included (Sara, 26 Oct). pg-boss (DECISIONS A1) is not wired yet, so the retry is in-process. */
export const SIGN_IN_EMAIL_ATTEMPTS = 3;
/** Wait before retry n (1-based): 1 s, then 2 s. */
export const SIGN_IN_EMAIL_RETRY_DELAYS_MS: readonly number[] = [1000, 2000];

export interface SignInEmailDeliveryOptions {
  readonly attempts?: number;
  readonly wait?: (milliseconds: number) => Promise<unknown>;
}

/**
 * Sends with bounded retry. After the last failed try it logs the failure with its reason and the number of tries only
 * (no address, no code, no link) and resolves; it never throws.
 */
export async function deliverSignInEmail(send: () => Promise<void>, options: SignInEmailDeliveryOptions = {}): Promise<void> {
  const attempts = options.attempts ?? SIGN_IN_EMAIL_ATTEMPTS;
  const wait = options.wait ?? sleep;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) {
      await wait(SIGN_IN_EMAIL_RETRY_DELAYS_MS[attempt - 2] ?? SIGN_IN_EMAIL_RETRY_DELAYS_MS.at(-1) ?? 0);
    }
    try {
      await send();
      return;
    } catch (error) {
      lastError = error;
    }
  }
  process.stdout.write(
    `${JSON.stringify({
      event: "sign_in_email_failed",
      reason: lastError instanceof EmailSendError ? lastError.reason : "unknown",
      attempts,
    })}\n`,
  );
}

/**
 * HEN-263 (Sara, 26 Oct): a sign-in email is queued, not awaited, so the response to a send never waits on the mail provider
 * (or its retries) and a known and an unknown email take the same path back.
 */
export function enqueueSignInEmail(send: () => Promise<void>): void {
  void deliverSignInEmail(send);
}
