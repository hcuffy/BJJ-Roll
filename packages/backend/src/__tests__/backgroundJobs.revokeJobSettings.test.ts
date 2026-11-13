import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { APPLE_REVOKE_QUEUE_NAME, BackgroundJobs } from "../jobs/backgroundJobs.js";
import type { ServerEventLine } from "../serverProcess.js";

type WorkHandler = (jobs: unknown[]) => Promise<void>;

const fakeBoss = vi.hoisted(() => ({
  queueOptions: new Map<string, Record<string, unknown>>(),
  handlers: new Map<string, (jobs: unknown[]) => Promise<void>>(),
  deleteJob: vi.fn<(queue: string, id: string) => Promise<void>>(),
}));

vi.mock("pg-boss", () => ({
  PgBoss: class {
    on(): void {}
    start(): Promise<void> {
      return Promise.resolve();
    }
    stop(): Promise<void> {
      return Promise.resolve();
    }
    schedule(): Promise<void> {
      return Promise.resolve();
    }
    createQueue(name: string, options: Record<string, unknown>): Promise<void> {
      fakeBoss.queueOptions.set(name, options);
      return Promise.resolve();
    }
    work(name: string, _options: unknown, handler: WorkHandler): Promise<string> {
      fakeBoss.handlers.set(name, handler);
      return Promise.resolve(name);
    }
    deleteJob(queue: string, id: string): Promise<void> {
      return fakeBoss.deleteJob(queue, id);
    }
  },
}));

const revokeJob = { id: "job-1", retryCount: 0, retryLimit: 10, data: { sealedRefreshToken: "sealed" } };

async function startJobs(logLines: ServerEventLine[]): Promise<WorkHandler> {
  const jobs = new BackgroundJobs({
    connectionString: "postgres://unused",
    pool: {} as Pool,
    revokeAppleRefreshToken: () => Promise.resolve(),
    logEvent: (line) => logLines.push(line),
  });
  await jobs.start();
  const handler = fakeBoss.handlers.get(APPLE_REVOKE_QUEUE_NAME);
  if (!handler) {
    throw new Error("Apple revoke worker was not registered");
  }
  return handler;
}

describe("Apple revoke queue settings and job clean-up", () => {
  beforeEach(() => {
    fakeBoss.queueOptions.clear();
    fakeBoss.handlers.clear();
    fakeBoss.deleteJob.mockReset();
  });

  it("keeps finished and dead Apple revoke jobs for exactly seven days", async () => {
    await startJobs([]);

    const options = fakeBoss.queueOptions.get(APPLE_REVOKE_QUEUE_NAME);
    expect(options?.retentionSeconds).toBe(604_800);
    expect(options?.deleteAfterSeconds).toBe(604_800);
  });

  it("a failed job delete after a good revoke is logged, not retried", async () => {
    fakeBoss.deleteJob.mockRejectedValue(new Error("connection reset"));
    const logLines: ServerEventLine[] = [];
    const handler = await startJobs(logLines);

    await expect(handler([revokeJob])).resolves.toBeUndefined();

    expect(fakeBoss.deleteJob).toHaveBeenCalledWith(APPLE_REVOKE_QUEUE_NAME, "job-1");
    expect(logLines).toEqual([{ event: "apple_revoke_job_delete_failed", jobId: "job-1" }]);
  });
});
