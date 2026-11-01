import { AGE_GATE_REFUSAL_MESSAGE } from "@bjj-roll/shared";
import { describe, expect, it } from "vitest";
import { DEEP_LINK_CALLBACK_URL } from "../auth/index.js";
import { createAgeGateTestContext, magicLinkSendPath, otpSendPath, otpSignInPath } from "./ageGateTestContext.js";
import { extractSessionCookie, postAuthJson, continueMagicLink } from "./authTestHelper.js";
import { isPostgresTestEnvironmentAvailable } from "./databaseTestHarness.js";

describe.skipIf(!isPostgresTestEnvironmentAvailable())("HEN-263 age gate 16+ (replaces the HEN-77 send-time refusal)", () => {
  const {
    current,
    capturedLogs,
    latestOtpFor,
    latestMagicLinkFor,
    countRows,
    consentRowsFor,
    rateLimitCounts,
    changedRateLimitKeys,
    sendOtp,
    signUpWithOtp,
  } = createAgeGateTestContext();

  describe("AC 1: the send step answers every email the same way", () => {
    const ageAnswerVariants = [
      { name: "no age answer", answers: {} },
      { name: "age16Confirmed false", answers: { age16Confirmed: false } },
      { name: "age16Confirmed as a string", answers: { age16Confirmed: "true" } },
      { name: "age16Confirmed true", answers: { age16Confirmed: true } },
      { name: "age16Confirmed and age18Confirmed true", answers: { age16Confirmed: true, age18Confirmed: true } },
    ];

    it.each([
      { name: "OTP send", path: otpSendPath, extraBody: { type: "sign-in" } },
      { name: "magic link send", path: magicLinkSendPath, extraBody: { callbackURL: DEEP_LINK_CALLBACK_URL } },
    ])(
      "$name: known and unknown emails get the same status and body, with or without the 16+ tick, and each gets an email",
      async ({ path, extraBody }) => {
        const { app, emailSender } = current();
        const responses: { status: number; body: string }[] = [];
        for (const [index, variant] of ageAnswerVariants.entries()) {
          for (const email of ["known.member@example.com", `unknown.${path.length}.${index}@example.com`]) {
            await current().pool.query("DELETE FROM public.rate_limits WHERE key LIKE 'email:%'");
            const sentBefore = emailSender.sentMessages.length;
            const response = await postAuthJson(app, path, {
              body: { email, ...extraBody, ...variant.answers },
              ipAddress: `198.51.100.${100 + index}`,
            });
            responses.push({ status: response.status, body: await response.text() });
            expect(emailSender.sentMessages.length).toBe(sentBefore + 1);
            expect(extractSessionCookie(response)).toBe("");
          }
        }
        expect(new Set(responses.map((response) => response.status))).toEqual(new Set([200]));
        expect(new Set(responses.map((response) => response.body)).size).toBe(1);
        expect(responses[0]?.body).not.toContain(AGE_GATE_REFUSAL_MESSAGE);
      },
    );
  });

  describe("AC 1 & 2: the age check runs where the account is created, and a refusal never touches the send counters", () => {
    it.each([
      { name: "no age answer", answers: {} },
      { name: "age16Confirmed false", answers: { age16Confirmed: false } },
      { name: "only age18Confirmed true", answers: { age18Confirmed: true } },
    ])("OTP: a valid code for a new email sent with $name is refused with the 16+ message and creates nothing", async ({ answers }) => {
      const { app } = current();
      const email = `refused.otp.${Object.keys(answers).join("-") || "none"}@example.com`.toLowerCase();
      expect((await sendOtp(email, "198.51.100.181", answers)).status).toBe(200);
      const before = { users: await countRows("users"), sessions: await countRows("sessions"), consent: await countRows("consent_records") };
      const rateLimitsBefore = await rateLimitCounts();

      const refused = await postAuthJson(app, otpSignInPath, {
        body: { email, otp: latestOtpFor(email), age16Confirmed: true },
        ipAddress: "198.51.100.181",
      });

      expect(refused.status).toBe(400);
      expect(await refused.json()).toMatchObject({ code: "AGE_CONFIRMATION_REQUIRED", message: AGE_GATE_REFUSAL_MESSAGE });
      expect(extractSessionCookie(refused)).toBe("");
      expect(await countRows("users")).toBe(before.users);
      expect(await countRows("sessions")).toBe(before.sessions);
      expect(await countRows("consent_records")).toBe(before.consent);
      for (const key of changedRateLimitKeys(rateLimitsBefore, await rateLimitCounts())) {
        expect(key).not.toMatch(/send-verification-otp|\/sign-in\/magic-link|^email:/u);
      }
    });

    it("magic link: verifying a link for a new email sent without the tick is refused and creates no user, session or exchange code", async () => {
      const { app } = current();
      const email = "refused.link@example.com";
      const sendResponse = await postAuthJson(app, magicLinkSendPath, {
        body: { email, callbackURL: DEEP_LINK_CALLBACK_URL },
        ipAddress: "198.51.100.182",
      });
      expect(sendResponse.status).toBe(200);
      const before = { users: await countRows("users"), sessions: await countRows("sessions") };
      const rateLimitsBefore = await rateLimitCounts();

      const verifyResponse = await continueMagicLink(app, latestMagicLinkFor(email), { ipAddress: "198.51.100.182" });

      expect(verifyResponse.status).toBe(400);
      expect(await verifyResponse.json()).toMatchObject({ code: "AGE_CONFIRMATION_REQUIRED", message: AGE_GATE_REFUSAL_MESSAGE });
      expect(new URL(verifyResponse.headers.get("location") ?? "bjjroll://auth").searchParams.get("code")).toBeNull();
      expect(await countRows("users")).toBe(before.users);
      expect(await countRows("sessions")).toBe(before.sessions);
      for (const key of changedRateLimitKeys(rateLimitsBefore, await rateLimitCounts())) {
        expect(key).not.toMatch(/send-verification-otp|\/sign-in\/magic-link|^email:/u);
      }
    });

    it("a refusal never locks the email out: the same email can tick the box, get a new code and sign up", async () => {
      const email = "refused.then.ticked@example.com";
      expect((await sendOtp(email, "198.51.100.183", {})).status).toBe(200);
      const refused = await postAuthJson(current().app, otpSignInPath, { body: { email, otp: latestOtpFor(email) }, ipAddress: "198.51.100.183" });
      expect(refused.status).toBe(400);
      const user = await signUpWithOtp(email, "198.51.100.183", { age16Confirmed: true });
      expect(await consentRowsFor(user.userId)).toHaveLength(1);
    });

    it("a still-valid ticked answer is not replaced by a different resend for the same email", async () => {
      const email = "ticked.then.unticked@example.com";
      expect((await sendOtp(email, "198.51.100.184", { age16Confirmed: true })).status).toBe(200);
      expect((await sendOtp(email, "198.51.100.184", {})).status).toBe(200);
      const signedIn = await postAuthJson(current().app, otpSignInPath, { body: { email, otp: latestOtpFor(email) }, ipAddress: "198.51.100.184" });
      expect(signedIn.status).toBe(200);
    });

    it("concurrent sends for one email leave one pending age answer row", async () => {
      const email = "concurrent.sends@example.com";
      const identifier = `age-confirmation-${current().codec.computeEmailHmac(email)}`;
      const responses = await Promise.all(
        [1, 2, 3].map((index) => sendOtp(email, `198.51.100.${String(190 + index)}`, { age16Confirmed: true, age18Confirmed: index % 2 === 0 })),
      );
      expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
      const rows = await current().pool.query<{ count: number }>("SELECT count(*)::int AS count FROM public.verifications WHERE identifier = $1", [
        identifier,
      ]);
      expect(rows.rows[0]?.count).toBe(1);
    });

    it("a send waits for the per-email lock before it writes the pending age answer", async () => {
      const email = "locked.send@example.com";
      const identifier = `age-confirmation-${current().codec.computeEmailHmac(email)}`;
      const holder = await current().pool.connect();
      let settled = false;
      try {
        await holder.query("BEGIN");
        await holder.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [identifier]);
        const pending = sendOtp(email, "198.51.100.195", { age16Confirmed: true }).finally(() => {
          settled = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 500));
        expect(settled).toBe(false);
        await holder.query("COMMIT");
        expect((await pending).status).toBe(200);
      } finally {
        holder.release();
      }
      const rows = await current().pool.query<{ count: number }>("SELECT count(*)::int AS count FROM public.verifications WHERE identifier = $1", [
        identifier,
      ]);
      expect(rows.rows[0]?.count).toBe(1);
    });
  });

  it("logs carry no email, age answer or refusal", () => {
    expect(capturedLogs.length).toBeGreaterThan(0);
    const allLogs = capturedLogs.join("\n").toLowerCase();
    expect(allLogs).not.toContain("age16confirmed");
    expect(allLogs).not.toContain("age18confirmed");
    expect(allLogs).not.toContain(AGE_GATE_REFUSAL_MESSAGE.toLowerCase());
    expect(allLogs).not.toContain("@example.com");
  });
});
