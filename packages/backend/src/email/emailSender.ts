/** What a one-time code is for. Default sign_in; account_deletion is the fresh code DELETE /account needs (HEN-65). */
export type OneTimeCodePurpose = "sign_in" | "account_deletion";

/** Set by the email queue to its job id: the provider sends once per key, so a retry after a timeout is not a second email (HEN-284). */
export interface EmailIdempotency {
  idempotencyKey?: string;
}

export interface SendOneTimeCodeInput extends EmailIdempotency {
  to: string;
  code: string;
  expiresInMinutes: number;
  purpose?: OneTimeCodePurpose;
}

/** The address is captured before the account is purged (HEN-65). */
export interface SendAccountDeletedNoticeInput extends EmailIdempotency {
  to: string;
}

export interface SendMagicLinkInput extends EmailIdempotency {
  to: string;
  url: string;
  expiresInMinutes: number;
}

export interface EmailSender {
  sendOneTimeCode(input: SendOneTimeCodeInput): Promise<void>;
  sendMagicLink(input: SendMagicLinkInput): Promise<void>;
  sendAccountDeletedNotice(input: SendAccountDeletedNoticeInput): Promise<void>;
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
  if (input.purpose === "account_deletion") {
    return {
      subject: "Your BJJ Roll code to delete your account",
      text: [
        `Your code to delete your BJJ Roll account is ${input.code}.`,
        `It expires in ${input.expiresInMinutes} minutes.`,
        "If you did not ask to delete your account, ignore this email and your account stays as it is.",
      ].join(" "),
    };
  }
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

export function renderAccountDeletedEmail(input: SendAccountDeletedNoticeInput): RenderedEmailMessage {
  assertNonEmptyText(input.to);
  return {
    subject: "Your BJJ Roll account was deleted",
    text: [
      "Your BJJ Roll account has been deleted, along with your handle and sign-in details. This cannot be undone.",
      "",
      "If you sign up again with this email address, you will get a new, empty account.",
    ].join("\n"),
  };
}
