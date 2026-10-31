import { accountExportSchema, signUpAttestationStatusSchema } from "@bjj-roll/shared";
import { describe, expect, it } from "vitest";
import { createAgeGateTestContext } from "./ageGateTestContext.js";
import { isPostgresTestEnvironmentAvailable } from "./databaseTestHarness.js";

const attestationRowsQuery = "SELECT 1 FROM public.consent_records WHERE user_id = $1 AND consent_type = 'attestation_signup'";

describe.skipIf(!isPostgresTestEnvironmentAvailable())("HEN-308 an account that has not accepted the attestation can export its data", () => {
  const { current, flow, capturedLogs, signUpWithOtp } = createAgeGateTestContext();

  it("with no attestation record (required: true), GET /account/export returns 200 and records no acceptance", async () => {
    const user = await signUpWithOtp("gated.export@example.com", "198.51.100.251", { age16Confirmed: true });
    await current().pool.query("DELETE FROM public.consent_records WHERE user_id = $1 AND consent_type = 'attestation_signup'", [user.userId]);
    const statusRequest = { cookie: user.cookie, ipAddress: user.ipAddress };
    const before = await flow.accountRequest("GET", "/account/signup-attestation", statusRequest);
    expect(signUpAttestationStatusSchema.parse(await before.json()).required).toBe(true);
    const logsBefore = capturedLogs.length;

    const exported = await flow.accountRequest("GET", "/account/export", statusRequest);
    expect(exported.status).toBe(200);
    const body = accountExportSchema.parse(await exported.json());
    expect(body.user.id).toBe(user.userId);
    expect(body.user.email).toBe("gated.export@example.com");

    const after = await flow.accountRequest("GET", "/account/signup-attestation", statusRequest);
    expect(signUpAttestationStatusSchema.parse(await after.json()).required).toBe(true);
    expect((await current().pool.query(attestationRowsQuery, [user.userId])).rowCount).toBe(0);

    const exportLogs = capturedLogs.slice(logsBefore).join("\n");
    expect(exportLogs).toContain("account_exported");
    expect(exportLogs).not.toContain("gated.export@example.com");
    expect(exportLogs).not.toContain(user.cookie);
  });
});
