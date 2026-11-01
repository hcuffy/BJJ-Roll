import type { Pool } from "pg";
import { PgBoss, type JobWithMetadata } from "pg-boss";
import { z } from "zod";
import type { AppleRevokeRetries } from "../accountRoutes.js";
import { errorClassName, logServerEventToStderr, type ServerEventLogger } from "../serverProcess.js";
import { AUTH_PRUNE_CRON, AUTH_PRUNE_QUEUE_NAME, pruneExpiredAuthRows } from "./pruneJob.js";

export const APPLE_REVOKE_QUEUE_NAME = "apple_revoke";
const APPLE_REVOKE_RETENTION_SECONDS = 7 * 24 * 60 * 60;

const appleRevokeJobSchema = z.object({ sealedRefreshToken: z.string().min(1) }).strict();

interface AppleRevokeRetryPolicy {
  readonly retryLimit: number;
  readonly retryDelaySeconds: number;
}

const defaultAppleRevokeRetry: AppleRevokeRetryPolicy = { retryLimit: 10, retryDelaySeconds: 60 };

export interface BackgroundJobsOptions {
  readonly connectionString: string;
  readonly pool: Pool;
  readonly revokeAppleRefreshToken: (sealedRefreshToken: string) => Promise<void>;
  readonly logEvent?: ServerEventLogger;
  readonly pollingIntervalSeconds?: number;
  readonly appleRevokeRetry?: AppleRevokeRetryPolicy;
}

export class BackgroundJobs implements AppleRevokeRetries {
  readonly #boss: PgBoss;
  readonly #options: BackgroundJobsOptions;
  readonly #logEvent: ServerEventLogger;

  constructor(options: BackgroundJobsOptions) {
    this.#boss = new PgBoss({ connectionString: options.connectionString, max: 2, schedule: true });
    this.#options = options;
    this.#logEvent = options.logEvent ?? logServerEventToStderr;
    this.#boss.on("error", (error: Error) => {
      this.#logEvent({ event: "background_jobs_error", errorClass: errorClassName(error) });
    });
  }

  async start(): Promise<void> {
    const retry = this.#options.appleRevokeRetry ?? defaultAppleRevokeRetry;
    const pollingIntervalSeconds = this.#options.pollingIntervalSeconds ?? 2;
    await this.#boss.start();
    await this.#boss.createQueue(AUTH_PRUNE_QUEUE_NAME, { retryLimit: 0, expireInSeconds: 300 });
    await this.#boss.schedule(AUTH_PRUNE_QUEUE_NAME, AUTH_PRUNE_CRON);
    await this.#boss.work(AUTH_PRUNE_QUEUE_NAME, { pollingIntervalSeconds }, async () => {
      const results = await pruneExpiredAuthRows(this.#options.pool);
      this.#logEvent({ event: "auth_rows_pruned", ...Object.fromEntries(results.map((result) => [result.table, result.deleted])) });
    });
    await this.#boss.createQueue(APPLE_REVOKE_QUEUE_NAME, {
      retryLimit: retry.retryLimit,
      retryDelay: retry.retryDelaySeconds,
      retryBackoff: true,
      retryDelayMax: 6 * 60 * 60,
      expireInSeconds: 60,
      retentionSeconds: APPLE_REVOKE_RETENTION_SECONDS,
      deleteAfterSeconds: APPLE_REVOKE_RETENTION_SECONDS,
    });
    await this.#boss.work(
      APPLE_REVOKE_QUEUE_NAME,
      { batchSize: 1, includeMetadata: true, pollingIntervalSeconds },
      async (jobs: JobWithMetadata<unknown>[]) => {
        for (const job of jobs) {
          await this.#revoke(job);
        }
      },
    );
  }

  async stop(): Promise<void> {
    await this.#boss.stop({ graceful: true, timeout: 5_000 });
  }

  async enqueue(sealedRefreshToken: string): Promise<void> {
    await this.#boss.send(APPLE_REVOKE_QUEUE_NAME, { sealedRefreshToken });
  }

  async #revoke(job: JobWithMetadata<unknown>): Promise<void> {
    const attempts = job.retryCount + 1;
    const parsed = appleRevokeJobSchema.safeParse(job.data);
    if (!parsed.success) {
      this.#logEvent({ event: "apple_revoke_dead_lettered", jobId: job.id, reason: "malformed_job", attempts });
      await this.#boss.deleteJob(APPLE_REVOKE_QUEUE_NAME, job.id);
      return;
    }
    try {
      await this.#options.revokeAppleRefreshToken(parsed.data.sealedRefreshToken);
    } catch {
      if (job.retryCount < job.retryLimit) {
        throw new Error("Apple revoke failed");
      }
      this.#logEvent({ event: "apple_revoke_dead_lettered", jobId: job.id, reason: "revoke_failed", attempts });
    }
    try {
      await this.#boss.deleteJob(APPLE_REVOKE_QUEUE_NAME, job.id);
    } catch {
      this.#logEvent({ event: "apple_revoke_job_delete_failed", jobId: job.id });
    }
  }
}
