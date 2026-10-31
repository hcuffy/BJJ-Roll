import {
  EmailSendError,
  type EmailSender,
  type OneTimeCodePurpose,
  renderAccountDeletedEmail,
  renderMagicLinkEmail,
  renderOneTimeCodeEmail,
  type SendAccountDeletedNoticeInput,
  type SendMagicLinkInput,
  type SendOneTimeCodeInput,
} from "./emailSender.js";

export interface FakeSentOneTimeCodeMessage {
  idempotencyKey?: string;
  kind: "one_time_code";
  to: string;
  code: string;
  expiresInMinutes: number;
  purpose?: OneTimeCodePurpose;
  subject: string;
  text: string;
}

interface FakeSentMagicLinkMessage {
  idempotencyKey?: string;
  kind: "magic_link";
  to: string;
  url: string;
  expiresInMinutes: number;
  subject: string;
  text: string;
}

interface FakeSentAccountDeletedMessage {
  idempotencyKey?: string;
  kind: "account_deleted";
  to: string;
  subject: string;
  text: string;
}

export type FakeSentEmailMessage = FakeSentOneTimeCodeMessage | FakeSentMagicLinkMessage | FakeSentAccountDeletedMessage;

export class FakeEmailSender implements EmailSender {
  readonly #sentMessages: FakeSentEmailMessage[] = [];

  get sentMessages(): readonly FakeSentEmailMessage[] {
    return [...this.#sentMessages];
  }

  clear(): void {
    this.#sentMessages.length = 0;
  }

  sendOneTimeCode(input: SendOneTimeCodeInput): Promise<void> {
    try {
      const rendered = renderOneTimeCodeEmail(input);
      this.#sentMessages.push({
        kind: "one_time_code",
        to: input.to.trim(),
        code: input.code,
        expiresInMinutes: input.expiresInMinutes,
        ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
        ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
        subject: rendered.subject,
        text: rendered.text,
      });
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new EmailSendError("configuration"));
    }
  }

  sendMagicLink(input: SendMagicLinkInput): Promise<void> {
    try {
      const rendered = renderMagicLinkEmail(input);
      this.#sentMessages.push({
        kind: "magic_link",
        to: input.to.trim(),
        url: input.url,
        expiresInMinutes: input.expiresInMinutes,
        ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
        subject: rendered.subject,
        text: rendered.text,
      });
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new EmailSendError("configuration"));
    }
  }

  sendAccountDeletedNotice(input: SendAccountDeletedNoticeInput): Promise<void> {
    try {
      const rendered = renderAccountDeletedEmail(input);
      this.#sentMessages.push({
        kind: "account_deleted",
        to: input.to.trim(),
        ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
        subject: rendered.subject,
        text: rendered.text,
      });
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new EmailSendError("configuration"));
    }
  }
}
