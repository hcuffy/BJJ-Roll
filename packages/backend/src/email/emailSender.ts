export interface SendOneTimeCodeInput {
  to: string;
  code: string;
  expiresInMinutes: number;
}

export interface SendMagicLinkInput {
  to: string;
  url: string;
  expiresInMinutes: number;
}

export interface EmailSender {
  sendOneTimeCode(input: SendOneTimeCodeInput): Promise<void>;
  sendMagicLink(input: SendMagicLinkInput): Promise<void>;
}

export type EmailSendFailureReason = "configuration" | "http_status" | "network" | "timeout";

/**
 * Typed error thrown when an email send fails.
 * By construction, its message and properties never contain the recipient address,
 * one-time code, magic-link URL, or provider API key.
 */
export class EmailSendError extends Error {
  readonly reason: EmailSendFailureReason;
  readonly statusCode: number | undefined;

  constructor(reason: EmailSendFailureReason, statusCode?: number) {
    const message = statusCode === undefined ? `Email send failed (${reason})` : `Email send failed (${reason}: HTTP ${statusCode})`;
    super(message);
    this.name = "EmailSendError";
    this.reason = reason;
    this.statusCode = statusCode;
  }
}

export interface RenderedEmailMessage {
  subject: string;
  text: string;
}

function assertNonEmptyText(value: string): void {
  if (value.trim().length === 0) {
    throw new EmailSendError("configuration");
  }
}

function assertPositiveMinutes(expiresInMinutes: number): void {
  if (!Number.isFinite(expiresInMinutes) || expiresInMinutes <= 0) {
    throw new EmailSendError("configuration");
  }
}

export function renderOneTimeCodeEmail(input: SendOneTimeCodeInput): RenderedEmailMessage {
  assertNonEmptyText(input.to);
  assertNonEmptyText(input.code);
  assertPositiveMinutes(input.expiresInMinutes);
  const lines = [
    `Your BJJ Roll sign-in code is ${input.code}.`,
    `It expires in ${input.expiresInMinutes} minutes.`,
    "If you did not request this code, ignore this email.",
  ];
  return {
    subject: "Your BJJ Roll sign-in code",
    text: lines.join(" "),
  };
}

export function renderMagicLinkEmail(input: SendMagicLinkInput): RenderedEmailMessage {
  assertNonEmptyText(input.to);
  assertNonEmptyText(input.url);
  assertPositiveMinutes(input.expiresInMinutes);
  const lines = [
    `Sign in to BJJ Roll by opening this link: ${input.url}`,
    "",
    `This link expires in ${input.expiresInMinutes} minutes. If you did not request this link, ignore this email.`,
  ];
  return {
    subject: "Your BJJ Roll sign-in link",
    text: lines.join("\n"),
  };
}
