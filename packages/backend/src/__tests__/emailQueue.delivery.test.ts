import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EMAIL_QUEUE_NAME, EMAIL_QUEUE_NOTICE_LIFETIME_SECONDS, FakeEmailSender, type QueuedEmail } from "../email/index.js";
import { isPostgresTestEnvironmentAvailable, startMigratedTestDatabase, type MigratedTestDatabase } from "./databaseTestHarness.js";
import { createTestEmailQueue, createTestKeyring, waitUntil } from "./emailQueueTestSupport.js";

const signInCode = (to: string, code: string): QueuedEmail => ({ kind: "one_time_code", input: { to, code, expiresInMinutes: 10 } });

describe.skipIf(!isPostgresTestEnvironmentAvailable())("HEN-284 durable email queue: enqueue, restart, one email per request", () => {
  let database: MigratedTestDatabase | undefined;

  const current = (): MigratedTestDatabase => {
    if (!database) {
      throw new Error("Test database not started");
    }
    return database;
  };

  beforeAll(async () => {
    database = await startMigratedTestDatabase();
  }, 60_000);

  afterAll(async () => {
    await database?.stop();
  }, 30_000);

  it("sends an enqueued sign-in code, magic link and account-deleted notice through the provider", async () => {
    const emailSender = new FakeEmailSender();
    const { queue } = createTestEmailQueue({ connectionString: current().connectionString, emailSender });
    await queue.start();
    try {
      await queue.enqueue(signInCode("queue.code@example.com", "123456"));
      await queue.enqueue({
        kind: "magic_link",
        input: { to: "queue.link@example.com", url: "https://example.test/verify?token=abc", expiresInMinutes: 10 },
      });
      await queue.enqueue({ kind: "account_deleted_notice", input: { to: "queue.gone@example.com" } }, { idempotencyKey: "account-deleted:user-1" });
      await waitUntil(() => emailSender.sentMessages.length === 3);
      expect(emailSender.sentMessages.map((message) => [message.kind, message.to]).sort()).toEqual([
        ["account_deleted", "queue.gone@example.com"],
        ["magic_link", "queue.link@example.com"],
        ["one_time_code", "queue.code@example.com"],
      ]);
    } finally {
      await queue.stop();
    }
  }, 30_000);

  it("keeps a job across a restart: enqueued while no worker runs, sent once a new worker starts", async () => {
    const keyring = createTestKeyring();
    const stoppedSender = new FakeEmailSender();
    const first = createTestEmailQueue({ connectionString: current().connectionString, emailSender: stoppedSender, keyring });
    await first.queue.start({ worker: false });
    await first.queue.enqueue(signInCode("queue.restart@example.com", "654321"));
    await first.queue.stop();

    const stored = await current().pool.query<{ state: string }>("SELECT state FROM pgboss.job WHERE name = $1", [EMAIL_QUEUE_NAME]);
    expect(stored.rows.some((row) => row.state === "created")).toBe(true);

    const restartedSender = new FakeEmailSender();
    const second = createTestEmailQueue({ connectionString: current().connectionString, emailSender: restartedSender, keyring });
    await second.queue.start();
    try {
      await waitUntil(() => restartedSender.sentMessages.some((message) => message.to === "queue.restart@example.com"));
      expect(stoppedSender.sentMessages).toHaveLength(0);
    } finally {
      await second.queue.stop();
    }
  }, 30_000);

  it("sends one email when the same request is enqueued twice before it is sent, and passes one provider idempotency key", async () => {
    const keyring = createTestKeyring();
    const emailSender = new FakeEmailSender();
    const producer = createTestEmailQueue({ connectionString: current().connectionString, emailSender, keyring });
    await producer.queue.start({ worker: false });
    await producer.queue.enqueue(signInCode("queue.twice@example.com", "111222"));
    await producer.queue.enqueue(signInCode("queue.twice@example.com", "111222"));
    await producer.queue.enqueue(signInCode("queue.twice@example.com", "333444"));
    await producer.queue.stop();
    const { queue } = createTestEmailQueue({ connectionString: current().connectionString, emailSender, keyring });
    await queue.start();
    try {
      await waitUntil(() => emailSender.sentMessages.filter((message) => message.to === "queue.twice@example.com").length >= 2);
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      const sent = emailSender.sentMessages.filter((message) => message.to === "queue.twice@example.com");
      expect(sent.map((message) => (message.kind === "one_time_code" ? message.code : "")).sort()).toEqual(["111222", "333444"]);
      expect(new Set(sent.map((message) => message.idempotencyKey)).size).toBe(2);
    } finally {
      await queue.stop();
    }
  }, 30_000);

  it("stores only a sealed payload: no address, code or link in the pg-boss tables", async () => {
    const emailSender = new FakeEmailSender();
    const { queue } = createTestEmailQueue({ connectionString: current().connectionString, emailSender });
    await queue.start({ worker: false });
    try {
      await queue.enqueue(signInCode("queue.sealed@example.com", "987123"));
      await queue.enqueue({
        kind: "magic_link",
        input: { to: "queue.sealed@example.com", url: "https://example.test/verify?token=sealedtoken", expiresInMinutes: 10 },
      });
    } finally {
      await queue.stop();
    }
    const rows = await current().pool.query<{ dump: string }>("SELECT row_to_json(job)::text AS dump FROM pgboss.job AS job WHERE name = $1", [
      EMAIL_QUEUE_NAME,
    ]);
    const dump = rows.rows.map((row) => row.dump).join("\n");
    expect(dump.length).toBeGreaterThan(0);
    for (const secret of ["queue.sealed", "example.com", "987123", "sealedtoken"]) {
      expect(dump).not.toContain(secret);
    }
  }, 30_000);

  it("deletes the job row as soon as the send succeeds", async () => {
    const emailSender = new FakeEmailSender();
    const { queue } = createTestEmailQueue({ connectionString: current().connectionString, emailSender });
    await queue.start();
    try {
      await queue.enqueue(signInCode("queue.deleted.row@example.com", "445566"));
      await waitUntil(() => emailSender.sentMessages.some((message) => message.to === "queue.deleted.row@example.com"));
      const jobId = emailSender.sentMessages.find((message) => message.to === "queue.deleted.row@example.com")?.idempotencyKey;
      await waitUntil(async () => (await current().pool.query("SELECT 1 FROM pgboss.job WHERE id = $1", [jobId])).rows.length === 0, 5_000);
      expect((await current().pool.query("SELECT 1 FROM pgboss.job WHERE id = $1", [jobId])).rows).toEqual([]);
    } finally {
      await queue.stop();
    }
  }, 30_000);

  it("the same request enqueued again after it was sent carries the same provider key, so the provider sends it once", async () => {
    const emailSender = new FakeEmailSender();
    const { queue } = createTestEmailQueue({ connectionString: current().connectionString, emailSender });
    await queue.start();
    try {
      const email = signInCode("queue.again@example.com", "778899");
      await queue.enqueue(email);
      await waitUntil(() => emailSender.sentMessages.some((message) => message.to === "queue.again@example.com"));
      await queue.enqueue(email);
      await waitUntil(() => emailSender.sentMessages.filter((message) => message.to === "queue.again@example.com").length === 2);
      const keys = emailSender.sentMessages.filter((message) => message.to === "queue.again@example.com").map((message) => message.idempotencyKey);
      expect(keys[1]).toBe(keys[0]);
    } finally {
      await queue.stop();
    }
  }, 30_000);

  it("caps an unsent job at the code or link expiry; the deleted notice, which has none, at 6 hours", async () => {
    const emailSender = new FakeEmailSender();
    const { queue } = createTestEmailQueue({ connectionString: current().connectionString, emailSender });
    await queue.start({ worker: false });
    try {
      await queue.enqueue(signInCode("queue.ttl.code@example.com", "135790"), { idempotencyKey: "ttl-code" });
      await queue.enqueue(
        { kind: "magic_link", input: { to: "queue.ttl.link@example.com", url: "https://example.test/verify?token=ttl", expiresInMinutes: 15 } },
        { idempotencyKey: "ttl-link" },
      );
      await queue.enqueue({ kind: "account_deleted_notice", input: { to: "queue.ttl.gone@example.com" } }, { idempotencyKey: "ttl-notice" });
    } finally {
      await queue.stop();
    }
    const rows = await current().pool.query<{ lifetime: number; deletion: number }>(
      `SELECT EXTRACT(EPOCH FROM keep_until - start_after)::int AS lifetime, deletion_seconds AS deletion
         FROM pgboss.job WHERE name = $1 AND state = 'created' ORDER BY lifetime`,
      [EMAIL_QUEUE_NAME],
    );
    expect(EMAIL_QUEUE_NOTICE_LIFETIME_SECONDS).toBe(6 * 60 * 60);
    expect(rows.rows.map((row) => row.lifetime)).toEqual(expect.arrayContaining([600, 900, 6 * 60 * 60]));
    expect(Math.max(...rows.rows.map((row) => row.lifetime))).toBeLessThanOrEqual(6 * 60 * 60);
    for (const row of rows.rows) {
      expect(row.deletion).toBe(row.lifetime);
    }
  }, 30_000);
});
