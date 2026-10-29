import type { EmailQueue, EmailSender, QueuedEmail } from "../email/index.js";

/**
 * Test double for the HEN-284 queue: starts the send straight away and does not wait for it, so the response never waits on the
 * provider and a test can read the sent message right after the response. No retry, no storage: the real queue is tested in
 * emailQueue.*.test.ts and auth.ageGate.sameWork.queued.test.ts.
 */
export class InlineEmailQueue implements EmailQueue {
  constructor(private readonly emailSender: EmailSender) {}

  enqueue(email: QueuedEmail): Promise<void> {
    void this.#send(email).catch(() => undefined);
    return Promise.resolve();
  }

  #send(email: QueuedEmail): Promise<void> {
    switch (email.kind) {
      case "one_time_code":
        return this.emailSender.sendOneTimeCode(email.input);
      case "magic_link":
        return this.emailSender.sendMagicLink(email.input);
      case "account_deleted_notice":
        return this.emailSender.sendAccountDeletedNotice(email.input);
    }
  }
}
