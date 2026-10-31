import type { EmailQueue, EmailSender, QueuedEmail } from "../email/index.js";

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
