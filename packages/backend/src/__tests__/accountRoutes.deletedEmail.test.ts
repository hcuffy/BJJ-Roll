import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { EmailSendError, FakeEmailSender, renderAccountDeletedEmail, type SendAccountDeletedNoticeInput } from "../email/index.js";
import { startAuthTestEnvironment, type StartedAuthTestEnvironment } from "./authTestHelper.js";
import { createAccountTestFlow } from "./accountTestFlow.js";
import { isPostgresTestEnvironmentAvailable } from "./databaseTestHarness.js";

/** Records whether the user row still existed at the moment the notice went out, and can be told to fail. */
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

describe.skipIf(!isPostgresTestEnvironmentAvailable())("HEN-65 account deleted email (Henry, 25 Oct)", () => {
  const emailSender = new ProbingEmailSender();
  let environment: StartedAuthTestEnvironment | undefined;
  const current = (): StartedAuthTestEnvironment => {
    if (!environment) {
      throw new Error("Auth test environment not initialized");
    }
    return environment;
  };

  beforeAll(async () => {
    environment = await startAuthTestEnvironment({ emailSender });
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

    const notices = emailSender.sentMessages.filter((message) => message.kind === "account_deleted");
    expect(notices).toEqual([{ kind: "account_deleted", to: "notice.sent@example.com", ...renderAccountDeletedEmail({ to: user.email }) }]);
    expect(notices[0]?.text).toContain("you will get a new, empty account");
    // The users row (and its encrypted address) was already gone when the notice was sent: the address came from the pre-purge capture.
    expect(emailSender.usersWithAddressAtSendTime).toEqual([0]);
  });

  it("still deletes when the notice fails to send, and logs the failure with the user id and reason but no address", async () => {
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
    } finally {
      emailSender.failNotice = false;
      stdoutSpy.mockRestore();
      for (const spy of consoleSpies) {
        spy.mockRestore();
      }
    }

    expect(status).toBe(200);
    expect((await current().pool.query("SELECT id FROM public.users WHERE id = $1", [user.userId])).rows).toEqual([]);
    const failureLines = lines.filter((line) => line.includes("account_deletion_email_failed"));
    expect(failureLines.map((line) => JSON.parse(line) as unknown)).toEqual([
      { event: "account_deletion_email_failed", userId: user.userId, reason: "network" },
    ]);
    const allLogs = lines.join("\n").toLowerCase();
    expect(allLogs).not.toContain(email);
    expect(allLogs).not.toContain(current().codec.computeEmailHmac(email));
  });
});
