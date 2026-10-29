import {
  EmailSendError,
  type EmailSender,
  type RenderedEmailMessage,
  renderAccountDeletedEmail,
  renderMagicLinkEmail,
  renderOneTimeCodeEmail,
  type SendAccountDeletedNoticeInput,
  type SendMagicLinkInput,
  type SendOneTimeCodeInput,
} from "./emailSender.js";

export type FetchFunction = typeof globalThis.fetch;

export const DEFAULT_LETTERMINT_ENDPOINT = "https://api.lettermint.co/v1/send";
export const DEFAULT_LETTERMINT_TIMEOUT_MILLISECONDS = 10_000;

export interface LettermintEmailSenderConfig {
  apiKey: string;
  fromAddress: string;
  endpoint?: string;
  timeoutMilliseconds?: number;
  fetchImplementation?: FetchFunction;
}

export interface LettermintSendRequestBody {
  from: string;
  to: [string];
  subject: string;
  text: string;
}

function isAbortOrTimeoutError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("name" in error)) {
    return false;
  }
  const errorName = (error as { name?: unknown }).name;
  return errorName === "TimeoutError" || errorName === "AbortError";
}

/**
 * Lettermint transactional email sender behind `EmailSender`.
 * Takes its API key and sender address via start-up configuration (never reads environment variables directly),
 * performs a single HTTP POST with no internal retry, and strips all PII and credentials from thrown errors.
 */
export class LettermintEmailSender implements EmailSender {
  readonly #apiKey: string;
  readonly #fromAddress: string;
  readonly #endpoint: string;
  readonly #timeoutMilliseconds: number;
  readonly #fetchImplementation: FetchFunction;

  constructor(config: LettermintEmailSenderConfig) {
    const trimmedApiKey = config.apiKey.trim();
    const trimmedFromAddress = config.fromAddress.trim();
    const endpoint = (config.endpoint ?? DEFAULT_LETTERMINT_ENDPOINT).trim();
    const timeoutMilliseconds = config.timeoutMilliseconds ?? DEFAULT_LETTERMINT_TIMEOUT_MILLISECONDS;
    if (
      trimmedApiKey.length === 0 ||
      trimmedFromAddress.length === 0 ||
      endpoint.length === 0 ||
      !Number.isFinite(timeoutMilliseconds) ||
      timeoutMilliseconds <= 0
    ) {
      throw new EmailSendError("configuration");
    }
    this.#apiKey = trimmedApiKey;
    this.#fromAddress = trimmedFromAddress;
    this.#endpoint = endpoint;
    this.#timeoutMilliseconds = timeoutMilliseconds;
    this.#fetchImplementation = config.fetchImplementation ?? globalThis.fetch;
  }

  toJSON(): { endpoint: string; fromAddress: string } {
    return { endpoint: this.#endpoint, fromAddress: this.#fromAddress };
  }

  async sendOneTimeCode(input: SendOneTimeCodeInput): Promise<void> {
    const rendered = renderOneTimeCodeEmail(input);
    await this.#postMessage(input.to.trim(), rendered, input.idempotencyKey);
  }

  async sendMagicLink(input: SendMagicLinkInput): Promise<void> {
    const rendered = renderMagicLinkEmail(input);
    await this.#postMessage(input.to.trim(), rendered, input.idempotencyKey);
  }

  async sendAccountDeletedNotice(input: SendAccountDeletedNoticeInput): Promise<void> {
    const rendered = renderAccountDeletedEmail(input);
    await this.#postMessage(input.to.trim(), rendered, input.idempotencyKey);
  }

  async #postMessage(recipientAddress: string, rendered: RenderedEmailMessage, idempotencyKey: string | undefined): Promise<void> {
    const requestBody: LettermintSendRequestBody = {
      from: this.#fromAddress,
      to: [recipientAddress],
      subject: rendered.subject,
      text: rendered.text,
    };

    let response: Response;
    try {
      response = await this.#fetchImplementation(this.#endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-lettermint-token": this.#apiKey,
          // Lettermint sends once per key for 24 h, so a retry after a timeout does not send the email twice.
          ...(idempotencyKey === undefined ? {} : { "Idempotency-Key": idempotencyKey }),
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(this.#timeoutMilliseconds),
      });
    } catch (error) {
      if (isAbortOrTimeoutError(error)) {
        throw new EmailSendError("timeout");
      }
      throw new EmailSendError("network");
    }

    if (!response.ok) {
      throw new EmailSendError("http_status", response.status);
    }
  }
}
