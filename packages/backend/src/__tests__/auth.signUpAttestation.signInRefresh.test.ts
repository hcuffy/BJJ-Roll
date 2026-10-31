import { signUpAttestationVersion, signUpAttestationStatusSchema, type SignUpAttestationStatus } from "@bjj-roll/shared";
import { describe, expect, it } from "vitest";
import { DEEP_LINK_CALLBACK_URL } from "../auth/index.js";
import type { SignedInUser } from "./accountTestFlow.js";
import { createAgeGateTestContext, magicLinkSendPath, otpSendPath, otpSignInPath } from "./ageGateTestContext.js";
import { extractSessionCookie, getAuthPath, postAuthJson } from "./authTestHelper.js";
import { isPostgresTestEnvironmentAvailable } from "./databaseTestHarness.js";

const currentVersionId = signUpAttestationVersion.id;
const oldVersionId = "attestation-signup-draft-0";

describe.skipIf(!isPostgresTestEnvironmentAvailable())("HEN-183 the sign-in tick refreshes the attestation for existing accounts", () => {
  const { current, flow, latestOtpFor, latestMagicLinkFor, signUpWithOtp } = createAgeGateTestContext();

  const readStatus = async (user: SignedInUser): Promise<SignUpAttestationStatus> => {
    const response = await flow.accountRequest("GET", "/account/signup-attestation", { cookie: user.cookie, ipAddress: user.ipAddress });
    expect(response.status).toBe(200);
    return signUpAttestationStatusSchema.parse(await response.json());
  };

  const attestationVersionsFor = async (userId: string): Promise<string[]> => {
    const result = await current().pool.query<{ text_version_id: string }>(
      "SELECT text_version_id FROM public.consent_records WHERE user_id = $1 AND consent_type = 'attestation_signup' ORDER BY accepted_at, id",
      [userId],
    );
    return result.rows.map((row) => row.text_version_id);
  };

  const existingUser = async (email: string, ipAddress: string, acceptedVersion: string | null): Promise<SignedInUser> => {
    const user = await signUpWithOtp(email, ipAddress, { age16Confirmed: true });
    await current().pool.query("DELETE FROM public.consent_records WHERE user_id = $1 AND consent_type = 'attestation_signup'", [user.userId]);
    if (acceptedVersion) {
      await current().pool.query(
        "INSERT INTO public.consent_records (id, user_id, consent_type, text_version_id) " +
          "VALUES (gen_random_uuid()::text, $1, 'attestation_signup', $2)",
        [user.userId, acceptedVersion],
      );
    }
    return user;
  };

  const signInWithOtp = async (user: SignedInUser, sendBody: Record<string, unknown>): Promise<SignedInUser> => {
    const send = await postAuthJson(current().app, otpSendPath, {
      body: { email: user.email, type: "sign-in", ...sendBody },
      ipAddress: user.ipAddress,
    });
    expect(send.status).toBe(200);
    const response = await postAuthJson(current().app, otpSignInPath, {
      body: { email: user.email, otp: latestOtpFor(user.email) },
      ipAddress: user.ipAddress,
    });
    expect(response.status).toBe(200);
    return { ...user, cookie: extractSessionCookie(response) };
  };

  const ticked = { age16Confirmed: true, signUpAttestationTextVersionId: currentVersionId };

  it("an existing account with no record that ticks at OTP sign-in gets a record at the current version and no re-prompt", async () => {
    const user = await existingUser("refresh.otp.none@example.com", "198.51.100.240", null);
    const returning = await signInWithOtp(user, ticked);
    expect(await attestationVersionsFor(user.userId)).toEqual([currentVersionId]);
    expect(await readStatus(returning)).toEqual({ required: false, currentTextVersionId: currentVersionId, acceptedTextVersionId: currentVersionId });
  });

  it("an existing account on an old version that ticks at magic-link sign-in gets a new current record; the old one stays", async () => {
    const user = await existingUser("refresh.link.old@example.com", "198.51.100.241", oldVersionId);
    const { app } = current();
    const send = await postAuthJson(app, magicLinkSendPath, {
      body: { email: user.email, callbackURL: DEEP_LINK_CALLBACK_URL, ...ticked },
      ipAddress: user.ipAddress,
    });
    expect(send.status).toBe(200);
    const verifyResponse = await getAuthPath(app, latestMagicLinkFor(user.email), { ipAddress: user.ipAddress });
    const exchangeCode = new URL(verifyResponse.headers.get("location") ?? "").searchParams.get("code") ?? "";
    const exchangeResponse = await postAuthJson(app, "/magic-link/exchange", { body: { code: exchangeCode }, ipAddress: user.ipAddress });
    expect(exchangeResponse.status).toBe(200);
    expect(await attestationVersionsFor(user.userId)).toEqual([oldVersionId, currentVersionId]);
    expect((await readStatus({ ...user, cookie: extractSessionCookie(exchangeResponse) })).required).toBe(false);
  });

  it("an account already on the current version that ticks again gets no second record", async () => {
    const user = await existingUser("refresh.otp.current@example.com", "198.51.100.242", currentVersionId);
    await signInWithOtp(user, ticked);
    expect(await attestationVersionsFor(user.userId)).toEqual([currentVersionId]);
  });

  it.each([
    { name: "no tick", sendBody: { age16Confirmed: true } },
    { name: "an old text version", sendBody: { age16Confirmed: true, signUpAttestationTextVersionId: oldVersionId } },
  ])("an existing account that signs in with $name gets no record and is still prompted", async ({ name, sendBody }) => {
    const user = await existingUser(`refresh.otp.${name.replaceAll(" ", "-")}@example.com`, "198.51.100.243", null);
    const returning = await signInWithOtp(user, sendBody);
    expect(await attestationVersionsFor(user.userId)).toEqual([]);
    expect((await readStatus(returning)).required).toBe(true);
  });

  it.each([
    { name: "OTP send", path: otpSendPath, extraBody: { type: "sign-in" } },
    { name: "magic link send", path: magicLinkSendPath, extraBody: { callbackURL: DEEP_LINK_CALLBACK_URL } },
  ])("the ticked $name answers an existing and a new email byte for byte the same (status and body)", async ({ path, extraBody }) => {
    const known = await existingUser(`same.answer.${path.length}@example.com`, "198.51.100.244", null);
    const observe = async (email: string, ipAddress: string): Promise<{ status: number; body: string }> => {
      const response = await postAuthJson(current().app, path, { body: { email, ...extraBody, ...ticked }, ipAddress });
      return { status: response.status, body: await response.text() };
    };
    const forKnown = await observe(known.email, "198.51.100.245");
    const forNew = await observe(`never.signed.up.${path.length}@example.com`, "198.51.100.246");
    expect(forKnown.status).toBe(200);
    expect(forNew).toEqual(forKnown);
  });
});
