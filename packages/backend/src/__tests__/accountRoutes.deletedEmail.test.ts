import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { EmailSendError, FakeEmailSender, renderAccountDeletedEmail, type SendAccountDeletedNoticeInput } from "../email/index.js";
import { startAuthTestEnvironment, type StartedAuthTestEnvironment } from "./authTestHelper.js";
import { createAccountTestFlow } from "./accountTestFlow.js";
import { isPostgresTestEnvironmentAvailable } from "./databaseTestHarness.js";

class ProbingEmailSender extends FakeEmailSender {
  failNotice = false;
  usersWithAddressAtSendTime: number[] = [];
  probe: ((to: string) => Promise<number>) | undefined;

  override async sendAccountDeletedNotice(input: SendAccountDeletedNoticeInput): Promise<void> {
    if (this.probe) {
      this.usersWithAddressAtSendTime.push(await this.probe(input.to));
    }
    if (this.failNotice) {
      throw new EmailSendError("network");
    }
    await super.sendAccountDeletedNotice(input);
  }
}

describe.skipIf(!isPostgresTestEnvironmentAvailable())("HEN-65 account deleted email, sent through the HEN-284 queue (Henry, 25 Oct)", () => {
  const emailSender = new ProbingEmailSender();
  let environment: StartedAuthTestEnvironment | undefined;
  const current = (): StartedAuthTestEnvironment => {
    if (!environment) {
      throw new Error("Auth test environment not initialized");
    }
    return environment;
  };

  beforeAll(async () => {
    environment = await startAuthTestEnvironment({ emailSender, emailQueue: "pg-boss" });
    const { pool, codec } = environment;
    emailSender.probe = async (to) => {
      const result = await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM public.users WHERE email_hash = $1", [
        codec.computeEmailHmac(to),
      ]);
      return result.rows[0]?.count ?? -1;
    };
  }, 60_000);

  afterAll(async () => {
    await environment?.stop();
  }, 30_000);

  const { signIn, deleteAccount } = createAccountTestFlow(current);

  it("emails the deleted notice to the address captured before the purge, once the account is gone", async () => {
    const user = await signIn("notice.sent@example.com", "198.51.100.130");
    const response = await deleteAccount(user);
    expect(response.status).toBe(200);

    const notices = () => emailSender.sentMessages.filter((message) => message.kind === "account_deleted");
    await vi.waitFor(() => expect(notices()).toHaveLength(1), { timeout: 15_000, interval: 50 });
    expect(notices()).toEqual([
      {
        kind: "account_deleted",
        to: "notice.sent@example.com",
        idempotencyKey: expect.any(String) as string,
        ...renderAccountDeletedEmail({ to: user.email }),
      },
    ]);
    expect(notices()[0]?.text).toContain("you will get a new, empty account");
    expect(emailSender.usersWithAddressAtSendTime).toEqual([0]);
  });

  it("still deletes when the notice keeps failing; the queue retries, then logs one dead-letter line with no address", async () => {
    const email = "notice.fails@example.com";
    const user = await signIn(email, "198.51.100.131");
    emailSender.failNotice = true;
    const lines: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      lines.push(String(chunk).trimEnd());
      return true;
    });
    const consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...entries: unknown[]) => lines.push(entries.map(String).join(" "))),
    );
    let status: number;
    try {
      status = (await deleteAccount(user)).status;
      await vi.waitFor(() => expect(current().emailQueueLogLines).toHaveLength(1), { timeout: 20_000, interval: 100 });
    } finally {
      emailSender.failNotice = false;
      stdoutSpy.mockRestore();
      for (const spy of consoleSpies) {
        spy.mockRestore();
      }
    }

    expect(status).toBe(200);
    expect((await current().pool.query("SELECT id FROM public.users WHERE id = $1", [user.userId])).rows).toEqual([]);
    expect(lines.filter((line) => line.includes("account_deletion_email_failed"))).toEqual([]);
    expect(current().emailQueueLogLines).toEqual([
      { event: "email_dead_lettered", jobId: expect.any(String) as unknown, template: "account_deleted_notice", errorClass: "network", attempts: 3 },
    ]);
    const allLogs = [...lines, ...current().emailQueueLogLines.map((line) => JSON.stringify(line))].join("\n").toLowerCase();
    expect(allLogs).not.toContain(email);
    expect(allLogs).not.toContain(current().codec.computeEmailHmac(email));
  }, 30_000);
});
