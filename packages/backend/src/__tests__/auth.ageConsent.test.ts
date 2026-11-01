import { AGE_CONFIRMATION_TEXT_VERSION_ID, accountExportSchema, ageConfirmationStatusSchema } from "@bjj-roll/shared";
import { describe, expect, it } from "vitest";
import { DEEP_LINK_CALLBACK_URL } from "../auth/index.js";
import { ageConfirmationPath, createAgeGateTestContext, magicLinkSendPath } from "./ageGateTestContext.js";
import {
  dumpRawAuthTables,
  postAuthJson,
  currentSignUpAttestation,
  boundMagicLinkSend,
  continueMagicLink,
  testSignInVerifier,
} from "./authTestHelper.js";
import { isPostgresTestEnvironmentAvailable } from "./databaseTestHarness.js";

const ageOrBirthColumnPattern = "(^|_)age($|_)|age_?confirm|age1[68]|birth|dob|adult|minor";

describe.skipIf(!isPostgresTestEnvironmentAvailable())("HEN-263 age consent records, canPurchase and export", () => {
  const { current, flow, latestMagicLinkFor, consentRowsFor, signUpWithOtp, readAgeStatus } = createAgeGateTestContext();

  describe("AC 4-6: the consent record, canPurchase and the later 18+ confirmation", () => {
    it.each([
      { name: "16+ only (18+ box left unticked)", answers: { age16Confirmed: true }, age18Confirmed: false },
      { name: "16+ and 18+", answers: { age16Confirmed: true, age18Confirmed: true }, age18Confirmed: true },
      { name: "16+ with age18Confirmed false", answers: { age16Confirmed: true, age18Confirmed: false }, age18Confirmed: false },
    ])("OTP sign-up with $name stores one age_confirmation record and canPurchase = age18Confirmed", async ({ answers, age18Confirmed }) => {
      const startedAt = Date.now();
      const user = await signUpWithOtp(`consent.${String(age18Confirmed)}.${Object.keys(answers).length}@example.com`, "198.51.100.185", answers);
      const rows = await consentRowsFor(user.userId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        user_id: user.userId,
        consent_type: "age_confirmation",
        text_version_id: AGE_CONFIRMATION_TEXT_VERSION_ID,
        age16_confirmed: true,
        age18_confirmed: age18Confirmed,
        withdrawn_at: null,
      });
      expect(rows[0]?.accepted_at.getTime()).toBeGreaterThanOrEqual(startedAt - 5_000);
      expect(await readAgeStatus(user)).toEqual({ age16Confirmed: true, age18Confirmed, canPurchase: age18Confirmed });
    });

    it("magic-link sign-up with both ticks stores the record and leaves no pending age answer behind", async () => {
      const { app, pool } = current();
      const email = "consent.link@example.com";
      const sendResponse = await postAuthJson(app, magicLinkSendPath, {
        body: {
          email,
          callbackURL: DEEP_LINK_CALLBACK_URL,
          age16Confirmed: true,
          ...currentSignUpAttestation,
          age18Confirmed: true,
          ...boundMagicLinkSend,
        },
        ipAddress: "198.51.100.186",
      });
      expect(sendResponse.status).toBe(200);
      const verifyResponse = await continueMagicLink(app, latestMagicLinkFor(email), { ipAddress: "198.51.100.186" });
      const exchangeCode = new URL(verifyResponse.headers.get("location") ?? "").searchParams.get("code") ?? "";
      const exchangeResponse = await postAuthJson(app, "/magic-link/exchange", {
        body: { code: exchangeCode, verifier: testSignInVerifier },
        ipAddress: "198.51.100.186",
      });
      expect(exchangeResponse.status).toBe(200);
      const userId = ((await exchangeResponse.json()) as { user: { id: string } }).user.id;
      expect(await consentRowsFor(userId)).toMatchObject([{ age16_confirmed: true, age18_confirmed: true }]);
      const pending = await pool.query("SELECT 1 FROM public.verifications WHERE identifier = $1", [
        `age-confirmation-${current().codec.computeEmailHmac(email)}`,
      ]);
      expect(pending.rowCount).toBe(0);
    });

    it("a returning user signs in without any age answer and gets no new record", async () => {
      const email = "returning.member@example.com";
      const user = await signUpWithOtp(email, "198.51.100.187", { age16Confirmed: true });
      const again = await signUpWithOtp(email, "198.51.100.187", {});
      expect(again.userId).toBe(user.userId);
      expect(await consentRowsFor(user.userId)).toHaveLength(1);
    });

    it("confirming 18+ later writes a new record with a new timestamp; there is no way to un-confirm", async () => {
      const user = await signUpWithOtp("later.adult@example.com", "198.51.100.188", { age16Confirmed: true });
      expect(await readAgeStatus(user)).toEqual({ age16Confirmed: true, age18Confirmed: false, canPurchase: false });
      const [signUpRecord] = await consentRowsFor(user.userId);

      for (const body of [{ age18Confirmed: false }, {}, { age18Confirmed: "true" }]) {
        const rejected = await flow.accountRequest("POST", ageConfirmationPath, { cookie: user.cookie, body, ipAddress: user.ipAddress });
        expect(rejected.status).toBe(400);
      }
      const confirmed = await flow.accountRequest("POST", ageConfirmationPath, {
        cookie: user.cookie,
        body: { age18Confirmed: true },
        ipAddress: user.ipAddress,
      });
      expect(confirmed.status).toBe(200);
      expect(ageConfirmationStatusSchema.parse(await confirmed.json())).toEqual({ age16Confirmed: true, age18Confirmed: true, canPurchase: true });

      const rows = await consentRowsFor(user.userId);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual(signUpRecord);
      expect(rows[1]).toMatchObject({ age16_confirmed: true, age18_confirmed: true, text_version_id: AGE_CONFIRMATION_TEXT_VERSION_ID });
      expect(rows[1]?.accepted_at.getTime()).toBeGreaterThan(signUpRecord?.accepted_at.getTime() ?? Number.POSITIVE_INFINITY);
      expect(await readAgeStatus(user)).toEqual({ age16Confirmed: true, age18Confirmed: true, canPurchase: true });

      const privileges = await current().pool.query<{ can_update: boolean; can_delete: boolean }>(
        [
          "SELECT has_table_privilege('bjj_app', 'public.consent_records', 'UPDATE') AS can_update,",
          "has_table_privilege('bjj_app', 'public.consent_records', 'DELETE') AS can_delete",
        ].join(" "),
      );
      expect(privileges.rows[0]).toEqual({ can_update: false, can_delete: false });
    });

    it("the age endpoints need a session", async () => {
      expect((await flow.accountRequest("GET", ageConfirmationPath)).status).toBe(401);
      expect((await flow.accountRequest("POST", ageConfirmationPath, { body: { age18Confirmed: true } })).status).toBe(401);
    });
  });

  describe("AC 7: the records are in the export and go with the account", () => {
    it("exports every age record, then deleting the account removes them", async () => {
      const user = await signUpWithOtp("export.and.delete@example.com", "198.51.100.189", { age16Confirmed: true });
      await flow.accountRequest("POST", ageConfirmationPath, { cookie: user.cookie, body: { age18Confirmed: true }, ipAddress: user.ipAddress });

      const exportResponse = await flow.accountRequest("GET", "/account/export", { cookie: user.cookie, ipAddress: user.ipAddress });
      expect(exportResponse.status).toBe(200);
      const exported = accountExportSchema.parse(await exportResponse.json());
      const ageRecords = exported.consentRecords.filter((record) => record.consentType === "age_confirmation");
      expect(ageRecords.map((record) => [record.consentType, record.age16Confirmed, record.age18Confirmed])).toEqual([
        ["age_confirmation", true, false],
        ["age_confirmation", true, true],
      ]);
      expect(ageRecords.every((record) => record.userId === user.userId && record.textVersionId === AGE_CONFIRMATION_TEXT_VERSION_ID)).toBe(true);

      expect((await flow.deleteAccount(user)).status).toBe(200);
      expect(await consentRowsFor(user.userId)).toEqual([]);
    });
  });

  it("AC 4: no birthdate anywhere; the only age columns are the two consent booleans", async () => {
    const columns = await current().pool.query<{ table_name: string; column_name: string }>(
      [
        "SELECT table_name, column_name FROM information_schema.columns",
        "WHERE table_schema = 'public' AND (column_name ~* $1 OR table_name ~* $1) ORDER BY column_name",
      ].join(" "),
      [ageOrBirthColumnPattern],
    );
    expect(columns.rows).toEqual([
      { table_name: "consent_records", column_name: "age16_confirmed" },
      { table_name: "consent_records", column_name: "age18_confirmed" },
    ]);
    const rawDump = (await dumpRawAuthTables(current().pool)).toLowerCase();
    expect(rawDump).not.toContain("age16confirmed");
    expect(rawDump).not.toContain("age18confirmed");
  });
});
