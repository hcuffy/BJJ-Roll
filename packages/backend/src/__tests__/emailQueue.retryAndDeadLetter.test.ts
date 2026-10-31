import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EMAIL_QUEUE_RETRY_DELAY_SECONDS, EmailSendError, FakeEmailSender, type QueuedEmail, type SendOneTimeCodeInput } from "../email/index.js";
import { isPostgresTestEnvironmentAvailable, startMigratedTestDatabase, type MigratedTestDatabase } from "./databaseTestHarness.js";
import { createTestEmailQueue, createTestKeyring, waitUntil } from "./emailQueueTestSupport.js";

class FlakyEmailSender extends FakeEmailSender {
  readonly tries: (string | undefined)[] = [];
  readonly triedAt: number[] = [];

  constructor(
    private readonly failures: number,
    private readonly error: Error = new EmailSendError("network"),
  ) {
    super();
  }

  override async sendOneTimeCode(input: SendOneTimeCodeInput): Promise<void> {
    this.tries.push(input.idempotencyKey);
    this.triedAt.push(performance.now());
    if (this.tries.length <= this.failures) {
      throw this.error;
    }
    await super.sendOneTimeCode(input);
  }
}

class SlowAcceptingProvider extends FakeEmailSender {
  readonly tries: (string | undefined)[] = [];
  readonly #deliveredKeys = new Set<string | undefined>();

  override async sendOneTimeCode(input: SendOneTimeCodeInput): Promise<void> {
    this.tries.push(input.idempotencyKey);
    if (!this.#deliveredKeys.has(input.idempotencyKey)) {
      this.#deliveredKeys.add(input.idempotencyKey);
      await super.sendOneTimeCode(input);
    }
    if (this.tries.length === 1) {
      throw new EmailSendError("timeout");
    }
  }
}

class SlowEmailSender extends FakeEmailSender {
  tries = 0;

  constructor(private readonly holdMilliseconds: number) {
    super();
  }

  override async sendOneTimeCode(input: SendOneTimeCodeInput): Promise<void> {
    this.tries += 1;
    await new Promise((resolve) => setTimeout(resolve, this.holdMilliseconds));
    await super.sendOneTimeCode(input);
  }
}

const address = "queue.retry.person@example.com";
const code = "246810";
const email: QueuedEmail = { kind: "one_time_code", input: { to: address, code, expiresInMinutes: 10 } };

describe.skipIf(!isPostgresTestEnvironmentAvailable())("HEN-284 email queue retries, dead-letter log and duplicate guard", () => {
  let database: MigratedTestDatabase | undefined;
  const connectionString = (): string => {
    if (!database) {
      throw new Error("Test database not started");
    }
    return database.connectionString;
  };

  beforeAll(async () => {
    database = await startMigratedTestDatabase();
  }, 60_000);

  afterAll(async () => {
    await database?.stop();
  }, 30_000);

  it("retries a failed send with backoff and stops at the first success, with the same provider key on every try", async () => {
    const emailSender = new FlakyEmailSender(2);
    const { queue, logLines } = createTestEmailQueue({ connectionString: connectionString(), emailSender });
    await queue.start();
    try {
      await queue.enqueue(email, { idempotencyKey: "retry-then-success" });
      await waitUntil(() => emailSender.sentMessages.length === 1, 20_000);
      expect(emailSender.tries).toHaveLength(3);
      expect(new Set(emailSender.tries).size).toBe(1);
      expect(logLines).toEqual([]);
    } finally {
      await queue.stop();
    }
  }, 30_000);

  it("waits before each retry, and longer before the second: first gap at least the 1 s retry delay, second at least double it", async () => {
    const emailSender = new FlakyEmailSender(2);
    const { queue } = createTestEmailQueue({ connectionString: connectionString(), emailSender });
    await queue.start();
    try {
      await queue.enqueue(email, { idempotencyKey: "retry-backoff-gaps" });
      await waitUntil(() => emailSender.sentMessages.length === 1, 20_000);
      expect(emailSender.triedAt).toHaveLength(3);
      const [first = 0, second = 0, third = 0] = emailSender.triedAt;
      const baseDelayMilliseconds = EMAIL_QUEUE_RETRY_DELAY_SECONDS * 1000;
      expect(second - first).toBeGreaterThanOrEqual(baseDelayMilliseconds - 100);
      expect(third - second).toBeGreaterThanOrEqual(2 * baseDelayMilliseconds - 100);
    } finally {
      await queue.stop();
    }
  }, 30_000);

  it("after the last try writes one log line with only the job id, template, error class and tries made, and deletes the job row", async () => {
    const emailSender = new FlakyEmailSender(Number.POSITIVE_INFINITY);
    const { queue, logLines } = createTestEmailQueue({ connectionString: connectionString(), emailSender });
    await queue.start();
    try {
      await queue.enqueue(email, { idempotencyKey: "always-fails" });
      await waitUntil(() => logLines.length === 1, 20_000);
      const jobId = emailSender.tries[0];
      expect(logLines).toEqual([{ event: "email_dead_lettered", jobId, template: "one_time_code", errorClass: "network", attempts: 3 }]);
      expect(emailSender.tries).toHaveLength(3);
      const logged = JSON.stringify(logLines);
      expect(logged).not.toContain(address);
      expect(logged).not.toContain(code);
      await waitUntil(async () => (await database?.pool.query("SELECT 1 FROM pgboss.job WHERE id = $1", [jobId]))?.rows.length === 0, 5_000);
    } finally {
      await queue.stop();
    }
  }, 30_000);

  it.each([
    { name: "a 4xx answer", error: new EmailSendError("http_status", 422), reason: "http_status" },
    { name: "a configuration error", error: new EmailSendError("configuration"), reason: "configuration" },
  ])(
    "does not retry $name: one try, then straight to the dead-letter log",
    async ({ error, reason }) => {
      const emailSender = new FlakyEmailSender(Number.POSITIVE_INFINITY, error);
      const { queue, logLines } = createTestEmailQueue({ connectionString: connectionString(), emailSender });
      await queue.start();
      try {
        await queue.enqueue(email, { idempotencyKey: `not-retried-${reason}` });
        await waitUntil(() => logLines.length === 1);
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        expect(emailSender.tries).toHaveLength(1);
        expect(logLines).toEqual([
          { event: "email_dead_lettered", jobId: emailSender.tries[0], template: "one_time_code", errorClass: reason, attempts: 1 },
        ]);
      } finally {
        await queue.stop();
      }
    },
    30_000,
  );

  it("retries a 429 rate-limit answer", async () => {
    const emailSender = new FlakyEmailSender(1, new EmailSendError("http_status", 429));
    const { queue, logLines } = createTestEmailQueue({ connectionString: connectionString(), emailSender });
    await queue.start();
    try {
      await queue.enqueue(email, { idempotencyKey: "rate-limited" });
      await waitUntil(() => emailSender.sentMessages.length === 1, 20_000);
      expect(emailSender.tries).toHaveLength(2);
      expect(logLines).toEqual([]);
    } finally {
      await queue.stop();
    }
  }, 30_000);

  it("a retry after the provider accepted but the client timed out reuses the key, so the person gets one email", async () => {
    const emailSender = new SlowAcceptingProvider();
    const { queue } = createTestEmailQueue({ connectionString: connectionString(), emailSender });
    await queue.start();
    try {
      await queue.enqueue(email, { idempotencyKey: "accepted-then-timeout" });
      await waitUntil(() => emailSender.tries.length === 2, 20_000);
      expect(emailSender.tries[1]).toBe(emailSender.tries[0]);
      expect(emailSender.sentMessages).toHaveLength(1);
    } finally {
      await queue.stop();
    }
  }, 30_000);

  it("a slow send still in flight is not sent again: not by a second worker, not by the same request enqueued again", async () => {
    const keyring = createTestKeyring();
    const emailSender = new SlowEmailSender(3_000);
    const first = createTestEmailQueue({ connectionString: connectionString(), emailSender, keyring });
    const second = createTestEmailQueue({ connectionString: connectionString(), emailSender, keyring });
    await first.queue.start();
    await second.queue.start();
    try {
      await first.queue.enqueue(email, { idempotencyKey: "slow-provider" });
      await waitUntil(() => emailSender.tries === 1);
      await second.queue.enqueue(email, { idempotencyKey: "slow-provider" });
      await waitUntil(() => emailSender.sentMessages.length === 1);
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      expect(emailSender.tries).toBe(1);
      expect(emailSender.sentMessages).toHaveLength(1);
    } finally {
      await first.queue.stop();
      await second.queue.stop();
    }
  }, 30_000);

  it('logs an unexpected error only as "unknown": no message text, so no address or code from it', async () => {
    const emailSender = new FlakyEmailSender(Number.POSITIVE_INFINITY, new Error(`provider said: bad recipient ${address} for code ${code}`));
    const { queue, logLines } = createTestEmailQueue({ connectionString: connectionString(), emailSender });
    await queue.start();
    try {
      await queue.enqueue(email, { idempotencyKey: "unexpected-error" });
      await waitUntil(() => logLines.length === 1, 20_000);
      expect(logLines).toEqual([
        { event: "email_dead_lettered", jobId: emailSender.tries[0], template: "one_time_code", errorClass: "unknown", attempts: 3 },
      ]);
      const logged = JSON.stringify(logLines);
      expect(logged).not.toContain(address);
      expect(logged).not.toContain(code);
      expect(logged).not.toContain("provider said");
    } finally {
      await queue.stop();
    }
  }, 30_000);

  it("a payload that cannot be opened is dead-lettered at once with an unknown template, and its row is deleted", async () => {
    const emailSender = new FlakyEmailSender(0);
    const storer = createTestEmailQueue({ connectionString: connectionString(), emailSender, keyring: createTestKeyring() });
    const worker = createTestEmailQueue({ connectionString: connectionString(), emailSender, keyring: createTestKeyring() });
    await storer.queue.start({ worker: false });
    try {
      await storer.queue.enqueue(email, { idempotencyKey: "unreadable-payload" });
      await worker.queue.start();
      await waitUntil(() => worker.logLines.length === 1, 20_000);
      const [line] = worker.logLines;
      expect(line).toEqual({
        event: "email_dead_lettered",
        jobId: expect.any(String) as unknown,
        template: "unknown",
        errorClass: "unknown",
        attempts: 1,
      });
      expect(emailSender.tries).toEqual([]);
      const logged = JSON.stringify(worker.logLines);
      expect(logged).not.toContain(address);
      expect(logged).not.toContain(code);
      await waitUntil(async () => (await database?.pool.query("SELECT 1 FROM pgboss.job WHERE id = $1", [line?.jobId]))?.rows.length === 0, 5_000);
    } finally {
      await worker.queue.stop();
      await storer.queue.stop();
    }
  }, 30_000);
});
