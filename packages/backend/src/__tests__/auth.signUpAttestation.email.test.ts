import {
  AGE_GATE_REFUSAL_MESSAGE,
  MAGIC_LINK_REASONS,
  SIGN_UP_ATTESTATION_REFUSAL_MESSAGE,
  SIGN_UP_ATTESTATION_TEXT_VERSION,
} from "@bjj-roll/shared";
import { describe, expect, it } from "vitest";
import { DEEP_LINK_CALLBACK_URL } from "../auth/index.js";
import { createAgeGateTestContext, magicLinkSendPath, otpSignInPath } from "./ageGateTestContext.js";
import { getAuthPath, postAuthJson } from "./authTestHelper.js";
import { isPostgresTestEnvironmentAvailable } from "./databaseTestHarness.js";

const currentVersionId = SIGN_UP_ATTESTATION_TEXT_VERSION.id;

interface AttestationRow {
  consent_type: string;
  text_version_id: string;
  age16_confirmed: boolean | null;
  age18_confirmed: boolean | null;
  withdrawn_at: Date | null;
  accepted_at: Date;
}

describe.skipIf(!isPostgresTestEnvironmentAvailable())("HEN-183 sign-up attestation on email OTP and magic-link sign-up", () => {
  const { current, latestOtpFor, latestMagicLinkFor, countRows, sendOtp, signUpWithOtp } = createAgeGateTestContext();

  const attestationRowsFor = async (userId: string): Promise<AttestationRow[]> => {
    const result = await current().pool.query<AttestationRow>(
      `SELECT consent_type, text_version_id, age16_confirmed, age18_confirmed, withdrawn_at, accepted_at
       FROM public.consent_records WHERE user_id = $1 AND consent_type = 'attestation_signup'`,
      [userId],
    );
    return result.rows;
  };

  const refusedOtpSignUp = async (email: string, answers: Record<string, unknown>): Promise<{ status: number; code: unknown; message: unknown }> => {
    const ipAddress = "198.51.100.190";
    expect((await sendOtp(email, ipAddress, answers)).status).toBe(200);
    const response = await postAuthJson(current().app, otpSignInPath, { body: { email, otp: latestOtpFor(email) }, ipAddress });
    const body = (await response.json()) as { code?: unknown; message?: unknown };
    return { status: response.status, code: body.code, message: body.message };
  };

  it("OTP sign-up with the current text version stores an attestation_signup record with that version and no age answers", async () => {
    const startedAt = Date.now();
    const user = await signUpWithOtp("attested.otp@example.com", "198.51.100.191", {
      age16Confirmed: true,
      signUpAttestationTextVersionId: currentVersionId,
    });
    const rows = await attestationRowsFor(user.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      consent_type: "attestation_signup",
      text_version_id: currentVersionId,
      age16_confirmed: null,
      age18_confirmed: null,
      withdrawn_at: null,
    });
    expect(rows[0]?.accepted_at.getTime()).toBeGreaterThanOrEqual(startedAt - 5_000);
  });

  it.each([
    { name: "no attestation", answers: { age16Confirmed: true, signUpAttestationTextVersionId: undefined } },
    { name: "an old text version", answers: { age16Confirmed: true, signUpAttestationTextVersionId: "attestation-signup-draft-0" } },
    { name: "a boolean instead of the version id", answers: { age16Confirmed: true, signUpAttestationTextVersionId: true } },
  ])("OTP sign-up with $name is refused and creates no user or record", async ({ name, answers }) => {
    const usersBefore = await countRows("users");
    const consentBefore = await countRows("consent_records");
    const refused = await refusedOtpSignUp(`unattested.${name.replaceAll(" ", "-")}@example.com`, answers);
    expect(refused).toEqual({ status: 400, code: "SIGN_UP_ATTESTATION_REQUIRED", message: SIGN_UP_ATTESTATION_REFUSAL_MESSAGE });
    expect(await countRows("users")).toBe(usersBefore);
    expect(await countRows("consent_records")).toBe(consentBefore);
  });

  it("a missing 16+ tick is still refused with the age message first (HEN-263 unchanged)", async () => {
    const refused = await refusedOtpSignUp("no.age.with.attestation@example.com", {
      age16Confirmed: undefined,
      signUpAttestationTextVersionId: undefined,
    });
    expect(refused).toEqual({ status: 400, code: "AGE_CONFIRMATION_REQUIRED", message: AGE_GATE_REFUSAL_MESSAGE });
  });

  it("magic-link sign-up without the attestation redirects with the attestation reason and creates no user", async () => {
    const { app } = current();
    const email = "unattested.link@example.com";
    const usersBefore = await countRows("users");
    const sendResponse = await postAuthJson(app, magicLinkSendPath, {
      body: { email, callbackURL: DEEP_LINK_CALLBACK_URL, age16Confirmed: true, signUpAttestationTextVersionId: undefined },
      ipAddress: "198.51.100.192",
    });
    expect(sendResponse.status).toBe(200);
    const verifyResponse = await getAuthPath(app, latestMagicLinkFor(email), { ipAddress: "198.51.100.192" });
    const location = new URL(verifyResponse.headers.get("location") ?? "");
    expect(location.searchParams.get("r")).toBe(MAGIC_LINK_REASONS.attestationRefused);
    expect(await countRows("users")).toBe(usersBefore);
  });

  it("magic-link sign-up with the attestation stores the record", async () => {
    const { app } = current();
    const email = "attested.link@example.com";
    await postAuthJson(app, magicLinkSendPath, {
      body: { email, callbackURL: DEEP_LINK_CALLBACK_URL, age16Confirmed: true, signUpAttestationTextVersionId: currentVersionId },
      ipAddress: "198.51.100.193",
    });
    const verifyResponse = await getAuthPath(app, latestMagicLinkFor(email), { ipAddress: "198.51.100.193" });
    const exchangeCode = new URL(verifyResponse.headers.get("location") ?? "").searchParams.get("code") ?? "";
    const exchangeResponse = await postAuthJson(app, "/magic-link/exchange", { body: { code: exchangeCode }, ipAddress: "198.51.100.193" });
    expect(exchangeResponse.status).toBe(200);
    const userId = ((await exchangeResponse.json()) as { user: { id: string } }).user.id;
    expect(await attestationRowsFor(userId)).toMatchObject([{ text_version_id: currentVersionId }]);
  });

  it("the database refuses an attestation_signup row carrying age answers", async () => {
    const user = await signUpWithOtp("constraint.check@example.com", "198.51.100.194", { age16Confirmed: true });
    await expect(
      current().pool.query(
        `INSERT INTO public.consent_records (id, user_id, consent_type, text_version_id, age16_confirmed, age18_confirmed)
         VALUES (gen_random_uuid()::text, $1, 'attestation_signup', $2, true, false)`,
        [user.userId, currentVersionId],
      ),
    ).rejects.toThrow(/consent_records_attestation_signup_no_answers/u);
  });
});
