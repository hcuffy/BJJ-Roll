import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
import { DEEP_LINK_CALLBACK_URL } from "../auth/index.js";
import { FakeEmailSender, type SendMagicLinkInput, type SendOneTimeCodeInput } from "../email/index.js";
import { magicLinkSendPath, otpSendPath, otpSignInPath } from "./ageGateTestContext.js";
import { postAuthJson, startAuthTestEnvironment, type StartedAuthTestEnvironment } from "./authTestHelper.js";
import { isPostgresTestEnvironmentAvailable } from "./databaseTestHarness.js";

/** Records each send when it starts; while `hold` is on, a send never finishes until `release()`. */
class HoldingEmailSender extends FakeEmailSender {
  hold = false;
  #releases: (() => void)[] = [];

  #wait(): Promise<void> {
    return this.hold ? new Promise((resolve) => this.#releases.push(resolve)) : Promise.resolve();
  }

  release(): void {
    for (const resolve of this.#releases.splice(0)) {
      resolve();
    }
  }

  override async sendOneTimeCode(input: SendOneTimeCodeInput): Promise<void> {
    await super.sendOneTimeCode(input);
    await this.#wait();
  }

  override async sendMagicLink(input: SendMagicLinkInput): Promise<void> {
    await super.sendMagicLink(input);
    await this.#wait();
  }
}

interface Observed {
  readonly status: number;
  readonly body: string;
  readonly headers: [string, string][];
  readonly queries: string[];
  readonly sendsStarted: number;
}

const knownEmail = "same.work.known@example.com";
const sendPaths = [
  { name: "OTP send", path: otpSendPath, extraBody: { type: "sign-in" } },
  { name: "magic link send", path: magicLinkSendPath, extraBody: { callbackURL: DEEP_LINK_CALLBACK_URL } },
];

// Timing is shown by structure, not a stopwatch (Sara, 26 Oct): the same SQL in the same order, the same response, and the email
// queued without waiting for it, for a known email, an unknown email, and a send whose sign-up will be refused (no 16+ tick).
// This suite uses the inline test queue; the real pg-boss path is in auth.ageGate.sameWork.queued.test.ts (HEN-284).
describe.skipIf(!isPostgresTestEnvironmentAvailable())("HEN-263 known, unknown and refused sends do the same work", () => {
  const emailSender = new HoldingEmailSender();
  let environment: StartedAuthTestEnvironment | undefined;
  let ipSuffix = 10;
  // Kept as a plain function and called with apply, so `this` is always the client that ran the query.
  const originalQuery = Object.getOwnPropertyDescriptor(Client.prototype, "query")?.value as (this: Client, ...queryArguments: unknown[]) => unknown;

  const observeSend = async (path: string, body: Record<string, unknown>): Promise<Observed> => {
    const { app, pool } = environment as StartedAuthTestEnvironment;
    await pool.query("DELETE FROM public.rate_limits");
    const queries: string[] = [];
    const querySpy = vi.spyOn(Client.prototype, "query").mockImplementation(function (this: Client, ...queryArguments: unknown[]) {
      const [config] = queryArguments;
      const text = typeof config === "string" ? config : (config as { text?: string } | undefined)?.text;
      queries.push((text ?? "").replace(/\s+/gu, " ").trim());
      return originalQuery.apply(this, queryArguments) as never;
    });
    const sentBefore = emailSender.sentMessages.length;
    ipSuffix += 1;
    try {
      const pending = postAuthJson(app, path, { body, ipAddress: `198.51.100.${ipSuffix}` });
      const timeout = new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 3_000));
      const response = await Promise.race([pending, timeout]);
      if (response === "blocked") {
        throw new Error("The send response waited for the email to be delivered");
      }
      const headers = [...response.headers.entries()].filter(([name]) => name !== "date").sort();
      return { status: response.status, body: await response.text(), headers, queries, sendsStarted: emailSender.sentMessages.length - sentBefore };
    } finally {
      querySpy.mockRestore();
    }
  };
  beforeAll(async () => {
    environment = await startAuthTestEnvironment({ emailSender });
    const { app } = environment;
    expect((await postAuthJson(app, otpSendPath, { body: { email: knownEmail, type: "sign-in", age16Confirmed: true } })).status).toBe(200);
    const sent = emailSender.sentMessages.at(-1);
    const otp = sent?.kind === "one_time_code" ? sent.code : "";
    expect((await postAuthJson(app, otpSignInPath, { body: { email: knownEmail, otp } })).status).toBe(200);
  }, 60_000);

  afterAll(async () => {
    emailSender.release();
    await environment?.stop();
  }, 30_000);

  it.each(sendPaths)(
    "$name: same SQL, same status, body and headers, and the email is queued, not awaited",
    async ({ path, extraBody }) => {
      emailSender.hold = true;
      try {
        const variants = {
          known: await observeSend(path, { email: knownEmail, ...extraBody, age16Confirmed: true }),
          unknown: await observeSend(path, { email: `same.work.new.${path.length}@example.com`, ...extraBody, age16Confirmed: true }),
          refused: await observeSend(path, { email: `same.work.refused.${path.length}@example.com`, ...extraBody }),
          knownUnticked: await observeSend(path, { email: knownEmail, ...extraBody }),
        };
        const [first, ...rest] = Object.values(variants);
        expect(first?.queries.length).toBeGreaterThan(0);
        for (const other of rest) {
          expect(other.queries).toEqual(first?.queries);
          expect({ status: other.status, body: other.body, headers: other.headers }).toEqual({
            status: first?.status,
            body: first?.body,
            headers: first?.headers,
          });
        }
        for (const observed of Object.values(variants)) {
          expect(observed.status).toBe(200);
          expect(observed.sendsStarted).toBe(1);
        }
      } finally {
        emailSender.hold = false;
        emailSender.release();
      }
    },
    30_000,
  );
});
