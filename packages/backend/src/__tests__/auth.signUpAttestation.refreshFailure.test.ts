import { SIGN_UP_ATTESTATION_TEXT_VERSION, signUpAttestationStatusSchema } from "@bjj-roll/shared";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import type { AuthCryptoCodec } from "../auth/authSecrets.js";
import { afterAuthRequest, type AuthEventName } from "../auth/socialSignInHooks.js";
import { createAgeGateTestContext, otpSendPath, otpSignInPath } from "./ageGateTestContext.js";
import { extractSessionCookie, postAuthJson } from "./authTestHelper.js";
import { isPostgresTestEnvironmentAvailable } from "./databaseTestHarness.js";

const refreshFailed = "signup_attestation_refresh_failed";

describe("HEN-183 a failed attestation refresh at sign-in (after hook)", () => {
  it.each(["/sign-in/email-otp", "/magic-link/verify"])("on %s resolves and logs only the user id", async (path) => {
    const events: { event: AuthEventName; userId: string }[] = [];
    const capture = {
      appleTokenClient: null,
      codec: { computeEmailHmac: () => "hmac" } as unknown as AuthCryptoCodec,
      logAuthEvent: (event: AuthEventName, userId: string) => events.push({ event, userId }),
    };
    const pool = { connect: () => Promise.reject(new Error("db down")) } as unknown as Pool;
    const middlewareContext = {
      path,
      body: {},
      context: { newSession: { user: { id: "user-1", email: "probe.member@example.com" } }, responseHeaders: new Headers() },
    } as unknown as Parameters<typeof afterAuthRequest>[0];

    await expect(afterAuthRequest(middlewareContext, capture, pool)).resolves.toBeUndefined();
    expect(events).toEqual([{ event: refreshFailed, userId: "user-1" }]);
    expect(JSON.stringify(events)).not.toContain("probe.member");
  });
});

describe.skipIf(!isPostgresTestEnvironmentAvailable())("HEN-183 a failed attestation refresh at sign-in (server)", () => {
  const { current, flow, capturedLogs, latestOtpFor, signUpWithOtp } = createAgeGateTestContext();

  it("a ticked OTP sign-in still completes when the attestation write fails; the log line has the user id and no email", async () => {
    const user = await signUpWithOtp("refresh.fails@example.com", "198.51.100.251", { age16Confirmed: true });
    const { pool, app } = current();
    await pool.query("DELETE FROM public.consent_records WHERE user_id = $1 AND consent_type = 'attestation_signup'", [user.userId]);
    await pool.query(
      "CREATE FUNCTION public.hen183_refuse_attestation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'refresh refused'; END $$",
    );
    await pool.query(
      "CREATE TRIGGER refuse_attestation BEFORE INSERT ON public.consent_records FOR EACH ROW " +
        "WHEN (NEW.consent_type = 'attestation_signup') EXECUTE FUNCTION public.hen183_refuse_attestation()",
    );
    try {
      const ticked = { age16Confirmed: true, signUpAttestationTextVersionId: SIGN_UP_ATTESTATION_TEXT_VERSION.id };
      const send = await postAuthJson(app, otpSendPath, { body: { email: user.email, type: "sign-in", ...ticked }, ipAddress: user.ipAddress });
      expect(send.status).toBe(200);
      const signIn = await postAuthJson(app, otpSignInPath, {
        body: { email: user.email, otp: latestOtpFor(user.email) },
        ipAddress: user.ipAddress,
      });
      expect(signIn.status).toBe(200);

      const cookie = extractSessionCookie(signIn);
      const status = await flow.accountRequest("GET", "/account/signup-attestation", { cookie, ipAddress: user.ipAddress });
      expect(status.status).toBe(200);
      expect(signUpAttestationStatusSchema.parse(await status.json()).required).toBe(true);
    } finally {
      await pool.query("DROP TRIGGER refuse_attestation ON public.consent_records");
      await pool.query("DROP FUNCTION public.hen183_refuse_attestation()");
    }
    const lines = capturedLogs.filter((line) => line.includes(refreshFailed));
    expect(lines).toEqual([`${JSON.stringify({ event: refreshFailed, userId: user.userId })}\n`]);
  });
});
