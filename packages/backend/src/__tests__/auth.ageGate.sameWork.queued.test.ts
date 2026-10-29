import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
import { DEEP_LINK_CALLBACK_URL } from "../auth/index.js";
import { EMAIL_QUEUE_NAME, EmailSendError, FakeEmailSender, type SendMagicLinkInput, type SendOneTimeCodeInput } from "../email/index.js";
import { magicLinkSendPath, otpSendPath, otpSignInPath } from "./ageGateTestContext.js";
import { currentSignUpAttestation, postAuthJson, startAuthTestEnvironment, type StartedAuthTestEnvironment } from "./authTestHelper.js";
import { isPostgresTestEnvironmentAvailable } from "./databaseTestHarness.js";

/** Records each try; `fail` makes every try throw after it is recorded. */
class FailingEmailSender extends FakeEmailSender {
  fail = false;

  override async sendOneTimeCode(input: SendOneTimeCodeInput): Promise<void> {
    await super.sendOneTimeCode(input);
    if (this.fail) {
      throw new EmailSendError("network");
    }
  }

  override async sendMagicLink(input: SendMagicLinkInput): Promise<void> {
    await super.sendMagicLink(input);
    if (this.fail) {
      throw new EmailSendError("network");
    }
  }
}

interface Observed {
  readonly status: number;
  readonly body: string;
  readonly headers: [string, string][];
  /** App SQL only: pg-boss runs its own timers in the same process, so its `pgboss.*` queries are left out. */
  readonly appQueries: string[];
  readonly jobsAdded: number;
}

const knownEmail = "same.work.queued.known@example.com";
const sendPaths = [
  { name: "OTP send", path: otpSendPath, extraBody: { type: "sign-in" } },
  { name: "magic link send", path: magicLinkSendPath, extraBody: { callbackURL: DEEP_LINK_CALLBACK_URL } },
];

// HEN-263 again with the real HEN-284 queue: every variant stores exactly one job and returns without waiting for the provider.
describe.skipIf(!isPostgresTestEnvironmentAvailable())("HEN-263 same work, with sign-in emails on the HEN-284 pg-boss queue", () => {
  const emailSender = new FailingEmailSender();
  let environment: StartedAuthTestEnvironment | undefined;
  let ipSuffix = 10;
  const originalQuery = Object.getOwnPropertyDescriptor(Client.prototype, "query")?.value as (this: Client, ...queryArguments: unknown[]) => unknown;

  const countJobs = async (): Promise<number> => {
    const result = await (environment as StartedAuthTestEnvironment).pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM pgboss.job WHERE name = $1",
      [EMAIL_QUEUE_NAME],
    );
    return result.rows[0]?.count ?? -1;
  };

  const observeSend = async (path: string, body: Record<string, unknown>): Promise<Observed> => {
    const { app, pool } = environment as StartedAuthTestEnvironment;
    await pool.query("DELETE FROM public.rate_limits");
    const jobsBefore = await countJobs();
    const queries: string[] = [];
    const querySpy = vi.spyOn(Client.prototype, "query").mockImplementation(function (this: Client, ...queryArguments: unknown[]) {
      const [config] = queryArguments;
      const text = typeof config === "string" ? config : (config as { text?: string } | undefined)?.text;
      queries.push((text ?? "").replace(/\s+/gu, " ").trim());
      return originalQuery.apply(this, queryArguments) as never;
    });
    ipSuffix += 1;
    let response: Response;
    try {
      response = await postAuthJson(app, path, { body, ipAddress: `198.51.100.${ipSuffix}` });
    } finally {
      querySpy.mockRestore();
    }
    const headers = [...response.headers.entries()].filter(([name]) => name !== "date").sort();
    return {
      status: response.status,
      body: await response.text(),
      headers,
      appQueries: queries.filter((query) => !query.includes("pgboss")),
      jobsAdded: (await countJobs()) - jobsBefore,
    };
  };

  beforeAll(async () => {
    environment = await startAuthTestEnvironment({ emailSender, emailQueue: "pg-boss" });
    const { app } = environment;
    expect(
      (await postAuthJson(app, otpSendPath, { body: { email: knownEmail, type: "sign-in", age16Confirmed: true, ...currentSignUpAttestation } }))
        .status,
    ).toBe(200);
    await vi.waitFor(() => expect(emailSender.sentMessages).toHaveLength(1), { timeout: 15_000, interval: 50 });
    const sent = emailSender.sentMessages.at(-1);
    const otp = sent?.kind === "one_time_code" ? sent.code : "";
    expect((await postAuthJson(app, otpSignInPath, { body: { email: knownEmail, otp } })).status).toBe(200);
  }, 60_000);

  afterAll(async () => {
    await environment?.stop();
  }, 30_000);

  it.each(sendPaths)(
    "$name: same app SQL, same status, body and headers, and one stored job for every variant",
    async ({ path, extraBody }) => {
      const variants = {
        known: await observeSend(path, { email: knownEmail, ...extraBody, age16Confirmed: true, ...currentSignUpAttestation }),
        unknown: await observeSend(path, {
          email: `same.work.queued.new.${path.length}@example.com`,
          ...extraBody,
          age16Confirmed: true,
          ...currentSignUpAttestation,
        }),
        refused: await observeSend(path, { email: `same.work.queued.refused.${path.length}@example.com`, ...extraBody }),
        knownUnticked: await observeSend(path, { email: knownEmail, ...extraBody }),
      };
      const [first, ...rest] = Object.values(variants);
      expect(first?.appQueries.length).toBeGreaterThan(0);
      for (const other of rest) {
        expect(other.appQueries).toEqual(first?.appQueries);
        expect({ status: other.status, body: other.body, headers: other.headers }).toEqual({
          status: first?.status,
          body: first?.body,
          headers: first?.headers,
        });
      }
      for (const observed of Object.values(variants)) {
        expect(observed.status).toBe(200);
        expect(observed.jobsAdded).toBe(1);
      }
    },
    30_000,
  );

  it("with a failing provider, known and unknown sends match; each job ends in one PII-free dead-letter line after 3 tries", async () => {
    emailSender.fail = true;
    try {
      const unknownEmail = "same.work.queued.failing.new@example.com";
      await vi.waitFor(
        async () =>
          expect(
            (await environment?.pool.query("SELECT 1 FROM pgboss.job WHERE name = $1 AND state < 'completed'", [EMAIL_QUEUE_NAME]))?.rows,
          ).toEqual([]),
        {
          timeout: 15_000,
          interval: 100,
        },
      );
      const logBefore = environment?.emailQueueLogLines.length ?? 0;
      const sentBefore = emailSender.sentMessages.length;
      const known = await observeSend(otpSendPath, { email: knownEmail, type: "sign-in", age16Confirmed: true, ...currentSignUpAttestation });
      const unknown = await observeSend(otpSendPath, { email: unknownEmail, type: "sign-in", age16Confirmed: true, ...currentSignUpAttestation });
      expect(known.status).toBe(200);
      expect(unknown.appQueries).toEqual(known.appQueries);
      expect({ status: unknown.status, body: unknown.body, headers: unknown.headers }).toEqual({
        status: known.status,
        body: known.body,
        headers: known.headers,
      });

      const newLines = () => environment?.emailQueueLogLines.slice(logBefore) ?? [];
      await vi.waitFor(() => expect(newLines()).toHaveLength(2), { timeout: 20_000, interval: 100 });
      expect(emailSender.sentMessages.length - sentBefore).toBe(6);
      for (const line of newLines()) {
        expect(line).toEqual({
          event: "email_dead_lettered",
          jobId: expect.any(String) as unknown,
          template: "one_time_code",
          errorClass: "network",
        });
        expect(JSON.stringify(line)).not.toContain(knownEmail);
        expect(JSON.stringify(line)).not.toContain(unknownEmail);
      }
    } finally {
      emailSender.fail = false;
    }
  }, 45_000);
});
