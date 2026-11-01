import { PgBoss } from "pg-boss";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createAuthCryptoCodec } from "../auth/authSecrets.js";
import { EMAIL_QUEUE_NAME, FakeEmailSender, type QueuedEmail } from "../email/index.js";
import { isPostgresTestEnvironmentAvailable, startMigratedTestDatabase, type MigratedTestDatabase } from "./databaseTestHarness.js";
import { createTestEmailQueue, createTestKeyring, waitUntil } from "./emailQueueTestSupport.js";

const address = "malformed.queue.person@example.com";
const keyring = createTestKeyring();
const codec = createAuthCryptoCodec(keyring);

describe.skipIf(!isPostgresTestEnvironmentAvailable())("L-b11 email queue drops malformed jobs and survives a failed job delete", () => {
  let database: MigratedTestDatabase | undefined;
  let rawBoss: PgBoss | undefined;
  const pool = () => {
    if (!database) {
      throw new Error("Test database not started");
    }
    return database.pool;
  };
  const jobExists = async (jobId: string) => (await pool().query("SELECT 1 FROM pgboss.job WHERE id = $1", [jobId])).rows.length > 0;

  beforeAll(async () => {
    database = await startMigratedTestDatabase();
  }, 60_000);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await rawBoss?.stop({ graceful: false });
    await database?.stop();
  }, 30_000);

  it.each([
    {
      name: "an unknown template",
      payload: { sealed: codec.encryptVerificationPayload(JSON.stringify({ kind: "newsletter", input: { to: address } })) },
    },
    {
      name: "a code email with no code",
      payload: { sealed: codec.encryptVerificationPayload(JSON.stringify({ kind: "one_time_code", input: { to: address, expiresInMinutes: 10 } })) },
    },
    { name: "a job that is not sealed", payload: { unexpected: `secret-looking-value ${address}` } },
  ])(
    "$name is dead-lettered once without its content, nothing is sent and the job is removed",
    async ({ payload }) => {
      const emailSender = new FakeEmailSender();
      const { queue, logLines } = createTestEmailQueue({ connectionString: database?.connectionString ?? "", emailSender, keyring });
      await queue.start();
      rawBoss ??= new PgBoss({ connectionString: database?.connectionString ?? "", schedule: false, supervise: false });
      await rawBoss.start();
      try {
        const jobId = await rawBoss.send(EMAIL_QUEUE_NAME, payload);
        await waitUntil(() => logLines.length === 1, 20_000);
        expect(logLines).toEqual([{ event: "email_dead_lettered", jobId, template: "unknown", errorClass: "malformed_job", attempts: 1 }]);
        expect(emailSender.sentMessages).toEqual([]);
        const logged = JSON.stringify(logLines);
        expect(logged).not.toContain(address);
        expect(logged).not.toContain("secret-looking-value");
        await waitUntil(async () => !(await jobExists(jobId ?? "")), 5_000);
      } finally {
        await queue.stop();
      }
    },
    30_000,
  );

  it("a failed job delete after a send is logged and does not send the email again", async () => {
    const emailSender = new FakeEmailSender();
    const { queue, logLines } = createTestEmailQueue({ connectionString: database?.connectionString ?? "", emailSender, keyring });
    const deleteSpy = vi.spyOn(PgBoss.prototype, "deleteJob").mockRejectedValueOnce(new Error("connection lost"));
    await queue.start();
    try {
      const email: QueuedEmail = { kind: "one_time_code", input: { to: address, code: "135790", expiresInMinutes: 10 } };
      await queue.enqueue(email, { idempotencyKey: "delete-fails" });
      await waitUntil(() => logLines.length === 1, 20_000);
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      expect(emailSender.sentMessages).toHaveLength(1);
      expect(deleteSpy).toHaveBeenCalledTimes(1);
      expect(logLines).toEqual([{ event: "email_job_delete_failed", jobId: expect.any(String) as string, template: "one_time_code" }]);
      expect(JSON.stringify(logLines)).not.toContain(address);
    } finally {
      await queue.stop();
    }
  }, 30_000);
});
