import {
  EmailSendError,
  type EmailSender,
  renderMagicLinkEmail,
  renderOneTimeCodeEmail,
  type SendMagicLinkInput,
  type SendOneTimeCodeInput,
} from "./emailSender.js";

export interface FakeSentOneTimeCodeMessage {
  kind: "one_time_code";
  to: string;
  code: string;
  expiresInMinutes: number;
  subject: string;
  text: string;
}

export interface FakeSentMagicLinkMessage {
  kind: "magic_link";
  to: string;
  url: string;
  expiresInMinutes: number;
  subject: string;
  text: string;
}

export type FakeSentEmailMessage = FakeSentOneTimeCodeMessage | FakeSentMagicLinkMessage;

/**
 * In-memory email sender for tests and local development without external network calls.
 * Stores sent messages only in memory; nothing is written to disk or logged.
 */
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
        subject: rendered.subject,
        text: rendered.text,
      });
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new EmailSendError("configuration"));
    }
  }
}
