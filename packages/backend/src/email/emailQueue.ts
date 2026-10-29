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

/** pg-boss queue for every email the backend sends after a request (HEN-284). pg-boss keeps it in its own `pgboss` schema. */
export const EMAIL_QUEUE_NAME = "email_send";
/** Retries after the first try, so 3 tries in all. */
export const EMAIL_QUEUE_RETRY_LIMIT = 2;
/** First retry delay; pg-boss doubles it per retry, with jitter. */
export const EMAIL_QUEUE_RETRY_DELAY_SECONDS = 1;
export const EMAIL_QUEUE_RETRY_DELAY_MAX_SECONDS = 60;
/** A try still running after this counts as failed. Well above the provider timeout (10 s), so a slow send is not retried while in flight. */
export const EMAIL_QUEUE_EXPIRE_SECONDS = 60;
/**
 * Lifetime of a job that holds no code or link (the account-deleted notice): at most 6 hours. A code or magic-link job lives
 * only as long as its code or link (`expiresInMinutes`). Every job row is deleted as soon as it is sent or finally fails.
 */
export const EMAIL_QUEUE_NOTICE_LIFETIME_SECONDS = 6 * 60 * 60;

export type QueuedEmail =
  | { readonly kind: "one_time_code"; readonly input: SendOneTimeCodeInput }
  | { readonly kind: "magic_link"; readonly input: SendMagicLinkInput }
  | { readonly kind: "account_deleted_notice"; readonly input: SendAccountDeletedNoticeInput };

export interface EnqueueEmailOptions {
  /** Same key, same job: a second enqueue adds nothing. Default: the email itself, so the same request twice sends one email. */
  readonly idempotencyKey?: string;
}

export interface EmailQueue {
  /** Resolves once the email is stored as a job. Never waits for the provider. */
  enqueue(email: QueuedEmail, options?: EnqueueEmailOptions): Promise<void>;
}

/**
 * The final-failure log line: only the job id, the template, a fixed error class and how many tries were made. Never the
 * address, code, link, a token or any provider text. `template` is "unknown" only when the payload could not be opened.
 */
export interface EmailQueueLogLine {
  readonly event: "email_dead_lettered";
  readonly jobId: string;
  readonly template: QueuedEmail["kind"] | "unknown";
  readonly errorClass: EmailSendError["reason"] | "unknown";
  /** Tries made, the failed one included (pg-boss `retryCount + 1`). */
  readonly attempts: number;
}

export type EmailQueueLogger = (line: EmailQueueLogLine) => void;

const defaultLogEvent: EmailQueueLogger = (line) => {
  process.stdout.write(`${JSON.stringify(line)}\n`);
};

export interface PgBossEmailQueueOptions {
  /** Postgres the app uses. pg-boss creates and migrates its `pgboss` schema there on start. */
  readonly connectionString: string;
  readonly emailSender: EmailSender;
  /** Seals the job payload (address, code, link) with the app data key, like emails at rest (D18). */
  readonly keyring: Keyring;
  readonly logEvent?: EmailQueueLogger;
  /** How often an idle worker looks for new jobs. Default: 1 s. */
  readonly pollingIntervalSeconds?: number;
}

export interface StartEmailQueueOptions {
  /** Default true. False only stores jobs (used by tests that stop the worker). */
  readonly worker?: boolean;
}

interface SealedEmailJob {
  readonly sealed: string;
}

/**
 * 4xx answers the provider will give again (bad request, auth, validation) and configuration errors are not retried.
 * 408, 409 (same idempotency key still in flight) and 429 are worth another try.
 */
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

/** How long the job row may live: the code or link expiry, or 6 hours for the notice. */
function jobLifetimeSeconds(email: QueuedEmail): number {
  return email.kind === "account_deleted_notice" ? EMAIL_QUEUE_NOTICE_LIFETIME_SECONDS : email.input.expiresInMinutes * 60;
}

const INSUFFICIENT_PRIVILEGE = "42501";

/** Turns pg-boss failing to create its schema into a message that names the missing permission. */
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

/** Durable email queue on pg-boss: jobs survive a restart, failed sends retry with backoff, then end in the failure log. */
export class PgBossEmailQueue implements EmailQueue {
  readonly #boss: PgBoss;
  readonly #connectionString: string;
  readonly #codec: AuthCryptoCodec;
  readonly #emailSender: EmailSender;
  readonly #logEvent: EmailQueueLogger;
  readonly #pollingIntervalSeconds: number;

  constructor(options: PgBossEmailQueueOptions) {
    this.#boss = new PgBoss({ connectionString: options.connectionString, max: 4, schedule: false });
    // pg-boss reports background errors here; without a listener Node would crash. The message has no email data.
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

  /** Waits for a send in flight, then stops. A job left unfinished is picked up again on the next start. */
  async stop(): Promise<void> {
    await this.#boss.stop({ graceful: true, timeout: 15_000 });
  }

  async enqueue(email: QueuedEmail, options: EnqueueEmailOptions = {}): Promise<void> {
    const jobKey = options.idempotencyKey ?? JSON.stringify([email.kind, email.input]);
    const job: SealedEmailJob = { sealed: this.#codec.encryptVerificationPayload(JSON.stringify(email)) };
    // A repeated id is ignored by pg-boss while the job exists, so the same request twice stores one job. Once sent and deleted,
    // a repeat gets the same id again, which is also the provider idempotency key, so the provider sends it once.
    // The row lives no longer than the code or link it carries: unsent, it is dropped at keep_until; finished, it is deleted.
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
      // Inside the try: a payload that cannot be opened (wrong key, corrupt row) is dead-lettered, not left to fail silently.
      const email = JSON.parse(this.#codec.decryptVerificationPayload(job.data.sealed)) as QueuedEmail;
      template = email.kind;
      await sendQueuedEmail(this.#emailSender, email, job.id);
    } catch (error) {
      // A payload that cannot be opened never will be, so only a send failure is retried.
      const retryable = template !== "unknown" && isRetryableEmailError(error);
      if (retryable && job.retryCount < job.retryLimit) {
        // pg-boss stores this error on the job, so it carries only the reason, never the provider error text.
        throw error instanceof EmailSendError ? new EmailSendError(error.reason, error.statusCode) : new Error("Email send failed (unknown)");
      }
      // Final failure (no retry left, or one the provider would refuse again): log it, then delete the row like a sent one.
      const errorClass = error instanceof EmailSendError ? error.reason : "unknown";
      this.#logEvent({ event: "email_dead_lettered", jobId: job.id, template, errorClass, attempts });
    }
    // Sent or finally failed: the encrypted payload is not kept a moment longer.
    await this.#boss.deleteJob(EMAIL_QUEUE_NAME, job.id);
  }
}
