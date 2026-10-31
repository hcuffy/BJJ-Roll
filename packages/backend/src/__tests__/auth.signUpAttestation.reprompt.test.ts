import {
  SIGN_UP_ATTESTATION_TEXT_VERSION,
  accountExportSchema,
  consentRecordSchema,
  signUpAttestationStatusSchema,
  type SignUpAttestationStatus,
} from "@bjj-roll/shared";
import { describe, expect, it } from "vitest";
import { accountDeletionCascadeMap } from "../database/cascadeDelete.js";
import type { SignedInUser } from "./accountTestFlow.js";
import { createAgeGateTestContext, otpSendPath, otpSignInPath } from "./ageGateTestContext.js";
import { extractSessionCookie, postAuthJson } from "./authTestHelper.js";
import { isPostgresTestEnvironmentAvailable } from "./databaseTestHarness.js";

const attestationPath = "/account/signup-attestation";
const currentVersionId = SIGN_UP_ATTESTATION_TEXT_VERSION.id;
const oldVersionId = "attestation-signup-draft-0";

describe.skipIf(!isPostgresTestEnvironmentAvailable())("HEN-183 sign-up attestation re-prompt, export and delete", () => {
  const { current, flow, latestOtpFor, signUpWithOtp } = createAgeGateTestContext();

  const readStatus = async (user: SignedInUser): Promise<SignUpAttestationStatus> => {
    const response = await flow.accountRequest("GET", attestationPath, { cookie: user.cookie, ipAddress: user.ipAddress });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    return signUpAttestationStatusSchema.parse(await response.json());
  };

  const accept = (user: SignedInUser, body: unknown): ReturnType<typeof flow.accountRequest> =>
    flow.accountRequest("POST", attestationPath, { cookie: user.cookie, body, ipAddress: user.ipAddress });

  const attestationVersionsFor = async (userId: string): Promise<string[]> => {
    const result = await current().pool.query<{ text_version_id: string }>(
      "SELECT text_version_id FROM public.consent_records WHERE user_id = $1 AND consent_type = 'attestation_signup' ORDER BY accepted_at, id",
      [userId],
    );
    return result.rows.map((row) => row.text_version_id);
  };

  const signInAgainWithoutAttestation = async (user: SignedInUser): Promise<SignedInUser> => {
    expect((await postAuthJson(current().app, otpSendPath, { body: { email: user.email, type: "sign-in" }, ipAddress: user.ipAddress })).status).toBe(
      200,
    );
    const response = await postAuthJson(current().app, otpSignInPath, {
      body: { email: user.email, otp: latestOtpFor(user.email) },
      ipAddress: user.ipAddress,
    });
    expect(response.status).toBe(200);
    return { ...user, cookie: extractSessionCookie(response) };
  };

  it("the attestation endpoints need a session", async () => {
    expect((await flow.accountRequest("GET", attestationPath)).status).toBe(401);
    expect((await flow.accountRequest("POST", attestationPath, { body: { textVersionId: currentVersionId } })).status).toBe(401);
  });

  it("a fresh sign-up has accepted the current version, so nothing is required", async () => {
    const user = await signUpWithOtp("attested.fresh@example.com", "198.51.100.230", { age16Confirmed: true });
    expect(await readStatus(user)).toEqual({ required: false, currentTextVersionId: currentVersionId, acceptedTextVersionId: currentVersionId });
  });

  it("an existing account with no attestation record is prompted, and stays prompted until it accepts the current version", async () => {
    const user = await signUpWithOtp("attested.legacy@example.com", "198.51.100.231", { age16Confirmed: true });
    await current().pool.query("DELETE FROM public.consent_records WHERE user_id = $1 AND consent_type = 'attestation_signup'", [user.userId]);

    const returning = await signInAgainWithoutAttestation(user);
    expect(await readStatus(returning)).toEqual({ required: true, currentTextVersionId: currentVersionId, acceptedTextVersionId: null });

    for (const body of [{}, { textVersionId: oldVersionId }, { textVersionId: true }, { textVersionId: currentVersionId, extra: "free text" }]) {
      expect((await accept(returning, body)).status).toBe(400);
    }
    expect(await attestationVersionsFor(user.userId)).toEqual([]);
    expect((await readStatus(returning)).required).toBe(true);

    const accepted = await accept(returning, { textVersionId: currentVersionId });
    expect(accepted.status).toBe(200);
    expect(signUpAttestationStatusSchema.parse(await accepted.json())).toEqual({
      required: false,
      currentTextVersionId: currentVersionId,
      acceptedTextVersionId: currentVersionId,
    });
    expect(await attestationVersionsFor(user.userId)).toEqual([currentVersionId]);
  });

  it("a new text version forces re-acceptance on the next sign-in; the old record stays and a new one is added", async () => {
    const user = await signUpWithOtp("attested.old.version@example.com", "198.51.100.232", { age16Confirmed: true });
    await current().pool.query("UPDATE public.consent_records SET text_version_id = $2 WHERE user_id = $1 AND consent_type = 'attestation_signup'", [
      user.userId,
      oldVersionId,
    ]);

    const returning = await signInAgainWithoutAttestation(user);
    expect(await readStatus(returning)).toEqual({ required: true, currentTextVersionId: currentVersionId, acceptedTextVersionId: oldVersionId });

    expect((await accept(returning, { textVersionId: currentVersionId })).status).toBe(200);
    expect(await attestationVersionsFor(user.userId)).toEqual([oldVersionId, currentVersionId]);
    expect((await readStatus(returning)).required).toBe(false);
  });

  it("exports the attestation record (type, text version id, accepted at), then deleting the account removes it", async () => {
    const user = await signUpWithOtp("attested.export@example.com", "198.51.100.233", { age16Confirmed: true });

    const exportResponse = await flow.accountRequest("GET", "/account/export", { cookie: user.cookie, ipAddress: user.ipAddress });
    expect(exportResponse.status).toBe(200);
    const exported = accountExportSchema.parse(await exportResponse.json());
    const attestations = exported.consentRecords.filter((record) => record.consentType === "attestation_signup");
    expect(attestations).toHaveLength(1);
    expect(Object.keys(consentRecordSchema.parse(attestations[0])).sort()).toEqual([
      "acceptedAt",
      "consentType",
      "id",
      "textVersionId",
      "userId",
      "withdrawnAt",
    ]);
    expect(attestations[0]).toMatchObject({ userId: user.userId, textVersionId: currentVersionId, withdrawnAt: null });
    expect(exported.consentRecords.map((record) => record.consentType)).toEqual(["age_confirmation", "attestation_signup"]);

    expect(accountDeletionCascadeMap.find((entry) => entry.table === "consent_records")?.description).toContain("attestation");
    expect((await flow.deleteAccount(user)).status).toBe(200);
    expect(await attestationVersionsFor(user.userId)).toEqual([]);
  });
});
