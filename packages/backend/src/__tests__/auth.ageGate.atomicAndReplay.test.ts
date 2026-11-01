import { AGE_GATE_REFUSAL_MESSAGE, MAGIC_LINK_REASON_PARAM, magicLinkReasons } from "@bjj-roll/shared";
import { describe, expect, it } from "vitest";
import { recordPendingAgeAnswers } from "../auth/ageGate.js";
import { DEEP_LINK_CALLBACK_URL } from "../auth/index.js";
import { createAgeGateTestContext, magicLinkSendPath, otpSignInPath } from "./ageGateTestContext.js";
import { postAuthJson, currentSignUpAttestation, continueMagicLink } from "./authTestHelper.js";
import { isPostgresTestEnvironmentAvailable } from "./databaseTestHarness.js";

const failConsentInsertSql = [
  "CREATE FUNCTION public.hen263_fail_consent_insert() RETURNS trigger LANGUAGE plpgsql AS",
  "$$ BEGIN RAISE EXCEPTION 'consent insert failed (test)'; END $$;",
  "CREATE TRIGGER hen263_fail_consent_insert BEFORE INSERT ON public.consent_records",
  "FOR EACH ROW EXECUTE FUNCTION public.hen263_fail_consent_insert();",
].join(" ");
const restoreConsentInsertSql = [
  "DROP TRIGGER IF EXISTS hen263_fail_consent_insert ON public.consent_records;",
  "DROP FUNCTION IF EXISTS public.hen263_fail_consent_insert();",
].join(" ");

describe.skipIf(!isPostgresTestEnvironmentAvailable())("HEN-263 atomic sign-up, no replay, reason-code redirects (Sara, 26 Oct)", () => {
  const { current, latestOtpFor, latestMagicLinkFor, countRows, sendOtp } = createAgeGateTestContext();

  const usersWithEmail = async (email: string): Promise<number> => {
    const { pool, codec } = current();
    const result = await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM public.users WHERE email_hash = $1", [
      codec.computeEmailHmac(email),
    ]);
    return result.rows[0]?.count ?? 0;
  };

  const sendMagicLink = (email: string, ipAddress: string, ageAnswers: Record<string, unknown>): Promise<Response> =>
    postAuthJson(current().app, magicLinkSendPath, {
      body: { email, callbackURL: DEEP_LINK_CALLBACK_URL, ...currentSignUpAttestation, ...ageAnswers },
      ipAddress,
    });

  const tickLater = (email: string): Promise<void> =>
    recordPendingAgeAnswers(current().appLogin.pool, current().codec, {
      email,
      age16Confirmed: true,
      ...currentSignUpAttestation,
      age18Confirmed: false,
    });

  describe("item 2: the user row and its consent record are written in one transaction", () => {
    it.each([
      {
        name: "OTP",
        signUp: async (email: string, ipAddress: string): Promise<Response> => {
          expect((await sendOtp(email, ipAddress, { age16Confirmed: true })).status).toBe(200);
          return await postAuthJson(current().app, otpSignInPath, { body: { email, otp: latestOtpFor(email) }, ipAddress });
        },
      },
      {
        name: "magic link",
        signUp: async (email: string, ipAddress: string): Promise<Response> => {
          expect((await sendMagicLink(email, ipAddress, { age16Confirmed: true })).status).toBe(200);
          return await continueMagicLink(current().app, latestMagicLinkFor(email), { ipAddress });
        },
      },
    ])("$name: when the consent insert fails, neither the user row nor a consent record exists", async ({ name, signUp }) => {
      const email = `atomic.${name.replace(" ", "-").toLowerCase()}@example.com`;
      const consentBefore = await countRows("consent_records");
      await current().pool.query(failConsentInsertSql);
      try {
        const response = await signUp(email, "198.51.100.190");
        expect(response.status).toBeGreaterThanOrEqual(400);
      } finally {
        await current().pool.query(restoreConsentInsertSql);
      }
      expect(await usersWithEmail(email)).toBe(0);
      expect(await countRows("consent_records")).toBe(consentBefore);
    });
  });

  describe("item 3: a refused sign-up burns the code or link (no replay)", () => {
    it("OTP: the refused code cannot be used again, even once the email has a ticked answer", async () => {
      const email = "replay.otp@example.com";
      expect((await sendOtp(email, "198.51.100.191", {})).status).toBe(200);
      const otp = latestOtpFor(email);
      const refused = await postAuthJson(current().app, otpSignInPath, { body: { email, otp }, ipAddress: "198.51.100.191" });
      expect(await refused.json()).toMatchObject({ code: "AGE_CONFIRMATION_REQUIRED" });

      await tickLater(email);
      const replay = await postAuthJson(current().app, otpSignInPath, { body: { email, otp }, ipAddress: "198.51.100.191" });

      expect(replay.status).toBe(400);
      expect(((await replay.json()) as { code: string }).code).not.toBe("AGE_CONFIRMATION_REQUIRED");
      expect(await usersWithEmail(email)).toBe(0);
    });

    it("magic link: the refused link cannot be opened again, even once the email has a ticked answer", async () => {
      const email = "replay.link@example.com";
      expect((await sendMagicLink(email, "198.51.100.192", {})).status).toBe(200);
      const link = latestMagicLinkFor(email);
      const refused = await continueMagicLink(current().app, link, { ipAddress: "198.51.100.192" });
      expect(new URL(refused.headers.get("location") ?? "").searchParams.get(MAGIC_LINK_REASON_PARAM)).toBe(magicLinkReasons.ageRefused);

      await tickLater(email);
      const replay = await continueMagicLink(current().app, link, { ipAddress: "198.51.100.192" });

      expect(replay.status).toBe(303);
      expect(replay.headers.get("location")).toBe(`${DEEP_LINK_CALLBACK_URL}?${MAGIC_LINK_REASON_PARAM}=${magicLinkReasons.linkInvalid}`);
      expect(await usersWithEmail(email)).toBe(0);
    });
  });

  describe("item 5: a failed magic link redirects with a reason code only", () => {
    const expectCodeOnlyLocation = (response: Response, reason: string): void => {
      const location = response.headers.get("location") ?? "";
      expect(location).toBe(`${DEEP_LINK_CALLBACK_URL}?${MAGIC_LINK_REASON_PARAM}=${reason}`);
      const url = new URL(location);
      expect([...url.searchParams.keys()]).toEqual([MAGIC_LINK_REASON_PARAM]);
      expect(url.hash).toBe("");
      expect(decodeURIComponent(location)).not.toMatch(/\s|error|older|expired|token/iu);
      expect(decodeURIComponent(location)).not.toContain(AGE_GATE_REFUSAL_MESSAGE);
    };

    it("age refusal: Location is bjjroll://auth?r=age_refused and nothing else", async () => {
      const email = "reason.age@example.com";
      expect((await sendMagicLink(email, "198.51.100.193", {})).status).toBe(200);
      const response = await continueMagicLink(current().app, latestMagicLinkFor(email), { ipAddress: "198.51.100.193" });
      expect(response.status).toBe(303);
      expectCodeOnlyLocation(response, magicLinkReasons.ageRefused);
    });

    it("unknown or used token: Location is bjjroll://auth?r=link_invalid and nothing else", async () => {
      const email = "reason.invalid@example.com";
      expect((await sendMagicLink(email, "198.51.100.194", { age16Confirmed: true })).status).toBe(200);
      const tampered = new URL(latestMagicLinkFor(email));
      tampered.searchParams.set("token", "not-a-real-token");
      const response = await continueMagicLink(current().app, tampered.toString(), { ipAddress: "198.51.100.194" });
      expect(response.status).toBe(303);
      expectCodeOnlyLocation(response, magicLinkReasons.linkInvalid);
    });
  });
});
