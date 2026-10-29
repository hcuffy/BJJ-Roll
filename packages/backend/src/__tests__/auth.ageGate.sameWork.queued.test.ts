import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
import { DEEP_LINK_CALLBACK_URL } from "../auth/index.js";
import {
  EMAIL_QUEUE_NAME,
  EmailSendError,
  FakeEmailSender,
  type QueuedEmail,
  type SendMagicLinkInput,
  type SendOneTimeCodeInput,
} from "../email/index.js";
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

let ipSuffix = 10;
const originalQuery = Object.getOwnPropertyDescriptor(Client.prototype, "query")?.value as (this: Client, ...queryArguments: unknown[]) => unknown;

const countJobs = async (environment: StartedAuthTestEnvironment): Promise<number> => {
  const result = await environment.pool.query<{ count: number }>("SELECT count(*)::int AS count FROM pgboss.job WHERE name = $1", [EMAIL_QUEUE_NAME]);
  return result.rows[0]?.count ?? -1;
};

const observeSend = async (environment: StartedAuthTestEnvironment, path: string, body: Record<string, unknown>): Promise<Observed> => {
  const { app, pool } = environment;
  await pool.query("DELETE FROM public.rate_limits");
  const jobsBefore = await countJobs(environment);
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
    jobsAdded: (await countJobs(environment)) - jobsBefore,
  };
};

/** Signs knownEmail up with the code that `readCode` finds once the send has returned. */
const signUpKnownEmail = async (environment: StartedAuthTestEnvironment, readCode: () => Promise<string>): Promise<void> => {
  const { app } = environment;
  const body = { email: knownEmail, type: "sign-in", age16Confirmed: true, ...currentSignUpAttestation };
  expect((await postAuthJson(app, otpSendPath, { body })).status).toBe(200);
  const otp = await readCode();
  expect((await postAuthJson(app, otpSignInPath, { body: { email: knownEmail, otp } })).status).toBe(200);
};

// HEN-263 again with the real HEN-284 queue: every variant stores exactly one job and returns without waiting for the provider.
// The worker is off (HEN-313): it deletes each job once sent, so with it on, a row count around a request could read 0 new jobs.
describe.skipIf(!isPostgresTestEnvironmentAvailable())("HEN-263 same work, with sign-in emails stored on the HEN-284 pg-boss queue", () => {
  let environment: StartedAuthTestEnvironment | undefined;

  beforeAll(async () => {
    const started = await startAuthTestEnvironment({ emailQueue: "pg-boss", emailQueueWorker: false });
    environment = started;
    // No worker sends the code, so read it from the one stored job.
    await signUpKnownEmail(started, async () => {
      const { rows } = await started.pool.query<{ data: { sealed: string } }>("SELECT data FROM pgboss.job WHERE name = $1", [EMAIL_QUEUE_NAME]);
      expect(rows).toHaveLength(1);
      const email = JSON.parse(started.codec.decryptVerificationPayload(rows[0]?.data.sealed ?? "")) as QueuedEmail;
      return email.kind === "one_time_code" ? email.input.code : "";
    });
  }, 60_000);

  afterAll(async () => {
    await environment?.stop();
  }, 30_000);

  it.each(sendPaths)(
    "$name: same app SQL, same status, body and headers, and one stored job for every variant",
    async ({ path, extraBody }) => {
      const started = environment as StartedAuthTestEnvironment;
      const variants = {
        known: await observeSend(started, path, { email: knownEmail, ...extraBody, age16Confirmed: true, ...currentSignUpAttestation }),
        unknown: await observeSend(started, path, {
          email: `same.work.queued.new.${path.length}@example.com`,
          ...extraBody,
          age16Confirmed: true,
          ...currentSignUpAttestation,
        }),
        refused: await observeSend(started, path, { email: `same.work.queued.refused.${path.length}@example.com`, ...extraBody }),
        knownUnticked: await observeSend(started, path, { email: knownEmail, ...extraBody }),
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
});

describe.skipIf(!isPostgresTestEnvironmentAvailable())("HEN-263 same work, with sign-in emails sent by the HEN-284 pg-boss worker", () => {
  const emailSender = new FailingEmailSender();
  let environment: StartedAuthTestEnvironment | undefined;

  beforeAll(async () => {
    const started = await startAuthTestEnvironment({ emailSender, emailQueue: "pg-boss" });
    environment = started;
    await signUpKnownEmail(started, async () => {
      await vi.waitFor(() => expect(emailSender.sentMessages).toHaveLength(1), { timeout: 15_000, interval: 50 });
      const sent = emailSender.sentMessages.at(-1);
      return sent?.kind === "one_time_code" ? sent.code : "";
    });
  }, 60_000);

  afterAll(async () => {
    await environment?.stop();
  }, 30_000);

  it("with a failing provider, known and unknown sends match; each job ends in one PII-free dead-letter line after 3 tries", async () => {
    const started = environment as StartedAuthTestEnvironment;
    emailSender.fail = true;
    try {
      const unknownEmail = "same.work.queued.failing.new@example.com";
      await vi.waitFor(
        async () =>
          expect(
            (await environment?.pool.query("SELECT 1 FROM pgboss.job WHERE name = $1 AND state < 'completed'", [EMAIL_QUEUE_NAME]))?.rows,
          ).toEqual([]),
        {
          // The sign-up job drains on its own; a full parallel run once needed more than 15 s.
          timeout: 30_000,
          interval: 100,
        },
      );
      const logBefore = environment?.emailQueueLogLines.length ?? 0;
      const sentBefore = emailSender.sentMessages.length;
      const known = await observeSend(started, otpSendPath, {
        email: knownEmail,
        type: "sign-in",
        age16Confirmed: true,
        ...currentSignUpAttestation,
      });
      const unknown = await observeSend(started, otpSendPath, {
        email: unknownEmail,
        type: "sign-in",
        age16Confirmed: true,
        ...currentSignUpAttestation,
      });
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
          attempts: 3,
        });
        expect(JSON.stringify(line)).not.toContain(knownEmail);
        expect(JSON.stringify(line)).not.toContain(unknownEmail);
      }
    } finally {
      emailSender.fail = false;
    }
  }, 60_000);
});
