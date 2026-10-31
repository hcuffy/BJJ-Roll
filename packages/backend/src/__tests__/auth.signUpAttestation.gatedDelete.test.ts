import { signUpAttestationStatusSchema } from "@bjj-roll/shared";
import { describe, expect, it } from "vitest";
import { createAgeGateTestContext } from "./ageGateTestContext.js";
import { isPostgresTestEnvironmentAvailable } from "./databaseTestHarness.js";

describe.skipIf(!isPostgresTestEnvironmentAvailable())("HEN-183 an account that has not accepted the attestation can delete itself", () => {
  const { current, flow, signUpWithOtp } = createAgeGateTestContext();

  it("with no attestation record (required: true), POST /account/delete-code and DELETE /account both succeed", async () => {
    const user = await signUpWithOtp("gated.delete@example.com", "198.51.100.250", { age16Confirmed: true });
    await current().pool.query("DELETE FROM public.consent_records WHERE user_id = $1 AND consent_type = 'attestation_signup'", [user.userId]);
    const status = await flow.accountRequest("GET", "/account/signup-attestation", { cookie: user.cookie, ipAddress: user.ipAddress });
    expect(signUpAttestationStatusSchema.parse(await status.json()).required).toBe(true);

    const code = await flow.requestDeleteCode(user);
    const deletion = await flow.accountRequest("DELETE", "/account", { cookie: user.cookie, body: { code }, ipAddress: user.ipAddress });
    expect(deletion.status).toBe(200);
    const left = await current().pool.query("SELECT 1 FROM public.users WHERE id = $1", [user.userId]);
    expect(left.rowCount).toBe(0);
  });
});
