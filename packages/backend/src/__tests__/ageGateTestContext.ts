import { ageConfirmationStatusSchema, signUpAttestationVersion } from "@bjj-roll/shared";
import { afterAll, beforeAll, expect, vi } from "vitest";
import { createAccountTestFlow, type SignedInUser } from "./accountTestFlow.js";
import { extractSessionCookie, postAuthJson, startAuthTestEnvironment, type StartedAuthTestEnvironment } from "./authTestHelper.js";

export const otpSendPath = "/email-otp/send-verification-otp";
export const magicLinkSendPath = "/sign-in/magic-link";
export const otpSignInPath = "/sign-in/email-otp";
export const ageConfirmationPath = "/account/age-confirmation";

export interface ConsentRow {
  user_id: string;
  consent_type: string;
  text_version_id: string;
  age16_confirmed: boolean;
  age18_confirmed: boolean;
  accepted_at: Date;
  withdrawn_at: Date | null;
}

const consentRowsQuery = [
  "SELECT user_id, consent_type, text_version_id, age16_confirmed, age18_confirmed, accepted_at, withdrawn_at",
  "FROM public.consent_records WHERE user_id = $1 AND consent_type = 'age_confirmation' ORDER BY accepted_at",
].join(" ");

export function createAgeGateTestContext() {
  let environment: StartedAuthTestEnvironment | undefined;
  const capturedLogs: string[] = [];

  const current = (): StartedAuthTestEnvironment => {
    if (!environment) {
      throw new Error("Auth test environment not initialized");
    }
    return environment;
  };
  const flow = createAccountTestFlow(current);

  const latestOtpFor = (email: string): string => flow.latestCodeFor(email, "sign_in");

  const latestMagicLinkFor = (email: string): string => {
    const sent = current()
      .emailSender.sentMessages.filter((message) => message.kind === "magic_link" && message.to.toLowerCase() === email.toLowerCase())
      .at(-1);
    if (!sent || sent.kind !== "magic_link") {
      throw new Error(`No magic link sent for ${email}`);
    }
    return sent.url;
  };

  const countRows = async (table: "users" | "sessions" | "consent_records"): Promise<number> => {
    const result = await current().pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM public.${table}`);
    return result.rows[0]?.count ?? 0;
  };

  const consentRowsFor = async (userId: string): Promise<ConsentRow[]> => {
    const result = await current().pool.query<ConsentRow>(consentRowsQuery, [userId]);
    return result.rows;
  };

  const rateLimitCounts = async (): Promise<Map<string, number>> => {
    const result = await current().pool.query<{ key: string; count: number }>("SELECT key, count FROM public.rate_limits");
    return new Map(result.rows.map((row) => [row.key, row.count]));
  };

  const changedRateLimitKeys = (before: Map<string, number>, after: Map<string, number>): string[] =>
    [...after.entries()].filter(([key, count]) => before.get(key) !== count).map(([key]) => key);

  const sendOtp = (email: string, ipAddress: string, ageAnswers: Record<string, unknown>): Promise<Response> =>
    postAuthJson(current().app, otpSendPath, {
      body: { email, type: "sign-in", signUpAttestationTextVersionId: signUpAttestationVersion.id, ...ageAnswers },
      ipAddress,
    });

  const signUpWithOtp = async (email: string, ipAddress: string, ageAnswers: Record<string, unknown>): Promise<SignedInUser> => {
    expect((await sendOtp(email, ipAddress, ageAnswers)).status).toBe(200);
    const signInResponse = await postAuthJson(current().app, otpSignInPath, { body: { email, otp: latestOtpFor(email) }, ipAddress });
    expect(signInResponse.status).toBe(200);
    const payload = (await signInResponse.json()) as { user: { id: string } };
    return { email, userId: payload.user.id, cookie: extractSessionCookie(signInResponse), ipAddress };
  };

  const readAgeStatus = async (user: SignedInUser): Promise<unknown> => {
    const response = await flow.accountRequest("GET", ageConfirmationPath, { cookie: user.cookie, ipAddress: user.ipAddress });
    expect(response.status).toBe(200);
    return ageConfirmationStatusSchema.parse(await response.json());
  };

  beforeAll(async () => {
    const recordLog = (...entries: unknown[]): void => {
      capturedLogs.push(entries.map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry))).join(" "));
    };
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation(recordLog);
    }
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      capturedLogs.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    });
    environment = await startAuthTestEnvironment({ logger: { disabled: false, level: "debug" } });
    await signUpWithOtp("known.member@example.com", "198.51.100.180", { age16Confirmed: true });
  }, 60_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await environment?.stop();
  }, 30_000);

  return {
    current,
    flow,
    capturedLogs,
    latestOtpFor,
    latestMagicLinkFor,
    countRows,
    consentRowsFor,
    rateLimitCounts,
    changedRateLimitKeys,
    sendOtp,
    signUpWithOtp,
    readAgeStatus,
  };
}
