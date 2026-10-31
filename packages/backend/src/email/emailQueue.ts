import { createHash } from "node:crypto";
import type { Keyring } from "@bjj-roll/shared/encryption";
import { PgBoss, type JobWithMetadata } from "pg-boss";
import { createAuthCryptoCodec, type AuthCryptoCodec } from "../auth/authSecrets.js";
import {
  EmailSendError,
  type EmailSender,
  type SendAccountDeletedNoticeInput,
  type SendMagicLinkInput,
  type SendOneTimeCodeInput,
} from "./emailSender.js";

export const EMAIL_QUEUE_NAME = "email_send";
export const EMAIL_QUEUE_RETRY_LIMIT = 2;
export const EMAIL_QUEUE_RETRY_DELAY_SECONDS = 1;
export const EMAIL_QUEUE_RETRY_DELAY_MAX_SECONDS = 60;
export const EMAIL_QUEUE_EXPIRE_SECONDS = 60;
export const EMAIL_QUEUE_NOTICE_LIFETIME_SECONDS = 6 * 60 * 60;

export type QueuedEmail =
  | { readonly kind: "one_time_code"; readonly input: SendOneTimeCodeInput }
  | { readonly kind: "magic_link"; readonly input: SendMagicLinkInput }
  | { readonly kind: "account_deleted_notice"; readonly input: SendAccountDeletedNoticeInput };

export interface EnqueueEmailOptions {
  readonly idempotencyKey?: string;
}

export interface EmailQueue {
  enqueue(email: QueuedEmail, options?: EnqueueEmailOptions): Promise<void>;
}

export interface EmailQueueLogLine {
  readonly event: "email_dead_lettered";
  readonly jobId: string;
  readonly template: QueuedEmail["kind"] | "unknown";
  readonly errorClass: EmailSendError["reason"] | "unknown";
  readonly attempts: number;
}

export type EmailQueueLogger = (line: EmailQueueLogLine) => void;

const defaultLogEvent: EmailQueueLogger = (line) => {
  process.stdout.write(`${JSON.stringify(line)}\n`);
};

export interface PgBossEmailQueueOptions {
  readonly connectionString: string;
  readonly emailSender: EmailSender;
  readonly keyring: Keyring;
  readonly logEvent?: EmailQueueLogger;
  readonly pollingIntervalSeconds?: number;
}

export interface StartEmailQueueOptions {
  readonly worker?: boolean;
}

interface SealedEmailJob {
  readonly sealed: string;
}

export function isRetryableEmailError(error: unknown): boolean {
  if (!(error instanceof EmailSendError)) {
    return true;
  }
  if (error.reason === "configuration") {
    return false;
  }
  if (error.reason === "http_status" && error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500) {
    return [408, 409, 429].includes(error.statusCode);
  }
  return true;
}

function jobIdFromKey(codec: AuthCryptoCodec, jobKey: string): string {
  const hex = createHash("sha256").update(codec.hashEmailQueueJobKey(jobKey)).digest("hex");
  const variant = ((Number.parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function jobLifetimeSeconds(email: QueuedEmail): number {
  return email.kind === "account_deleted_notice" ? EMAIL_QUEUE_NOTICE_LIFETIME_SECONDS : email.input.expiresInMinutes * 60;
}

const INSUFFICIENT_PRIVILEGE = "42501";

function describeStartupError(error: unknown, connectionString: string): unknown {
  if (typeof error !== "object" || error === null || (error as { code?: unknown }).code !== INSUFFICIENT_PRIVILEGE) {
    return error;
  }
  const url = new URL(connectionString);
  const role = decodeURIComponent(url.username);
  const database = decodeURIComponent(url.pathname.slice(1));
  return new Error(
    `Email queue cannot start: database role "${role}" needs the CREATE permission on database "${database}" ` +
      `to create the "pgboss" schema (GRANT CREATE ON DATABASE "${database}" TO "${role}").`,
    { cause: error },
  );
}

function sendQueuedEmail(emailSender: EmailSender, email: QueuedEmail, idempotencyKey: string): Promise<void> {
  switch (email.kind) {
    case "one_time_code":
      return emailSender.sendOneTimeCode({ ...email.input, idempotencyKey });
    case "magic_link":
      return emailSender.sendMagicLink({ ...email.input, idempotencyKey });
    case "account_deleted_notice":
      return emailSender.sendAccountDeletedNotice({ ...email.input, idempotencyKey });
  }
}

export class PgBossEmailQueue implements EmailQueue {
  readonly #boss: PgBoss;
  readonly #connectionString: string;
  readonly #codec: AuthCryptoCodec;
  readonly #emailSender: EmailSender;
  readonly #logEvent: EmailQueueLogger;
  readonly #pollingIntervalSeconds: number;

  constructor(options: PgBossEmailQueueOptions) {
    this.#boss = new PgBoss({ connectionString: options.connectionString, max: 4, schedule: false });
    this.#boss.on("error", (error: Error) => {
      process.stderr.write(`${JSON.stringify({ event: "email_queue_error", message: error.message })}\n`);
    });
    this.#connectionString = options.connectionString;
    this.#codec = createAuthCryptoCodec(options.keyring);
    this.#emailSender = options.emailSender;
    this.#logEvent = options.logEvent ?? defaultLogEvent;
    this.#pollingIntervalSeconds = options.pollingIntervalSeconds ?? 1;
  }

  async start(options: StartEmailQueueOptions = {}): Promise<void> {
    try {
      await this.#boss.start();
    } catch (error) {
      throw describeStartupError(error, this.#connectionString);
    }
    await this.#boss.createQueue(EMAIL_QUEUE_NAME, {
      retryLimit: EMAIL_QUEUE_RETRY_LIMIT,
      retryDelay: EMAIL_QUEUE_RETRY_DELAY_SECONDS,
      retryBackoff: true,
      retryDelayMax: EMAIL_QUEUE_RETRY_DELAY_MAX_SECONDS,
      expireInSeconds: EMAIL_QUEUE_EXPIRE_SECONDS,
      retentionSeconds: EMAIL_QUEUE_NOTICE_LIFETIME_SECONDS,
      deleteAfterSeconds: EMAIL_QUEUE_NOTICE_LIFETIME_SECONDS,
    });
    if (options.worker ?? true) {
      await this.#boss.work(
        EMAIL_QUEUE_NAME,
        { batchSize: 1, includeMetadata: true, pollingIntervalSeconds: this.#pollingIntervalSeconds },
        async (jobs: JobWithMetadata<SealedEmailJob>[]) => {
          for (const job of jobs) {
            await this.#deliver(job);
          }
        },
      );
    }
  }

  async stop(): Promise<void> {
    await this.#boss.stop({ graceful: true, timeout: 15_000 });
  }

  async enqueue(email: QueuedEmail, options: EnqueueEmailOptions = {}): Promise<void> {
    const jobKey = options.idempotencyKey ?? JSON.stringify([email.kind, email.input]);
    const job: SealedEmailJob = { sealed: this.#codec.encryptVerificationPayload(JSON.stringify(email)) };
    const lifetimeSeconds = jobLifetimeSeconds(email);
    await this.#boss.send(EMAIL_QUEUE_NAME, job, {
      id: jobIdFromKey(this.#codec, jobKey),
      retentionSeconds: lifetimeSeconds,
      deleteAfterSeconds: lifetimeSeconds,
    });
  }

  async #deliver(job: JobWithMetadata<SealedEmailJob>): Promise<void> {
    const attempts = job.retryCount + 1;
    let template: EmailQueueLogLine["template"] = "unknown";
    try {
      const email = JSON.parse(this.#codec.decryptVerificationPayload(job.data.sealed)) as QueuedEmail;
      template = email.kind;
      await sendQueuedEmail(this.#emailSender, email, job.id);
    } catch (error) {
      const retryable = template !== "unknown" && isRetryableEmailError(error);
      if (retryable && job.retryCount < job.retryLimit) {
        throw error instanceof EmailSendError ? new EmailSendError(error.reason, error.statusCode) : new Error("Email send failed (unknown)");
      }
      const errorClass = error instanceof EmailSendError ? error.reason : "unknown";
      this.#logEvent({ event: "email_dead_lettered", jobId: job.id, template, errorClass, attempts });
    }
    await this.#boss.deleteJob(EMAIL_QUEUE_NAME, job.id);
  }
}
