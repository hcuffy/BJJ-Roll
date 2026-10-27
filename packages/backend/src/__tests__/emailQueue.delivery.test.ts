import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EMAIL_QUEUE_NAME, FakeEmailSender, type QueuedEmail } from "../email/index.js";
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

  it("sends one email when the same request is enqueued twice, and passes one provider idempotency key", async () => {
    const emailSender = new FakeEmailSender();
    const { queue } = createTestEmailQueue({ connectionString: current().connectionString, emailSender });
    await queue.start();
    try {
      await queue.enqueue(signInCode("queue.twice@example.com", "111222"));
      await queue.enqueue(signInCode("queue.twice@example.com", "111222"));
      await queue.enqueue(signInCode("queue.twice@example.com", "333444"));
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
});
