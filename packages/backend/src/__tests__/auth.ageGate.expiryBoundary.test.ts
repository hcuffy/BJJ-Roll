import { signUpAttestationVersion } from "@bjj-roll/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { assertSignUpAgeConfirmation, recordPendingAgeAnswers } from "../auth/ageGate.js";
import { MAGIC_LINK_EXPIRY_SECONDS, OTP_EXPIRY_SECONDS } from "../auth/authLimits.js";
import { startAuthTestEnvironment, type StartedAuthTestEnvironment } from "./authTestHelper.js";
import { isPostgresTestEnvironmentAvailable } from "./databaseTestHarness.js";

const pendingExpiryMs = Math.max(OTP_EXPIRY_SECONDS, MAGIC_LINK_EXPIRY_SECONDS) * 1000;
const startMs = Date.parse("2026-03-01T10:00:00.000Z");
const notSocial = { social: false } as const;

describe.skipIf(!isPostgresTestEnvironmentAvailable())("HEN-335 pending age answer expiry boundary", () => {
  let environment: StartedAuthTestEnvironment | undefined;

  beforeAll(async () => {
    environment = await startAuthTestEnvironment();
  }, 60_000);

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    await environment?.stop();
  }, 30_000);

  const recordTickedAnswersAt = async (email: string, nowMs: number): Promise<StartedAuthTestEnvironment> => {
    if (!environment) {
      throw new Error("Auth test environment not initialized");
    }
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(nowMs);
    const body = { email, age16Confirmed: true, signUpAttestationTextVersionId: signUpAttestationVersion.id };
    await recordPendingAgeAnswers(environment.pool, environment.codec, body);
    return environment;
  };

  it("one millisecond before expiry the ticked answer still counts", async () => {
    const email = "expiry.before@example.com";
    const { pool, codec } = await recordTickedAnswersAt(email, startMs);
    vi.setSystemTime(startMs + pendingExpiryMs - 1);
    await expect(assertSignUpAgeConfirmation(pool, codec, { email, social: notSocial })).resolves.toBeUndefined();
  });

  it("at the exact expiry instant the answer has expired and sign-up is refused", async () => {
    const email = "expiry.exact@example.com";
    const { pool, codec } = await recordTickedAnswersAt(email, startMs);
    vi.setSystemTime(startMs + pendingExpiryMs);
    await expect(assertSignUpAgeConfirmation(pool, codec, { email, social: notSocial })).rejects.toMatchObject({
      body: { code: "AGE_CONFIRMATION_REQUIRED" },
    });
  });
});
