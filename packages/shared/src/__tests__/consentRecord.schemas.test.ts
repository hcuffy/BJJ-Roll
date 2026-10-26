import { describe, expect, it } from "vitest";
import { AGE_CONFIRMATION_TEXT_VERSION_ID, ageConfirmationRecordSchema, consentRecipientTypeSchema, consentRecordSchema } from "../index.js";
import { offsetLessTimestamp, otherId, timestamp, userId, videoId } from "./sampleValues.js";

const consentRecord = {
  id: otherId,
  userId,
  textVersionId: "consent-third-party-v1",
  acceptedAt: timestamp,
  withdrawnAt: null,
  consentType: "consent_third_party",
  videoId,
  recipientType: "ai_vendor",
  recipientUserId: null,
};

const cases = [
  { name: "consentRecipientTypeSchema", schema: consentRecipientTypeSchema, valid: "gym_mate", invalid: "advertiser" },
  { name: "consentRecordSchema", schema: consentRecordSchema, valid: consentRecord, invalid: { ...consentRecord, acceptedAt: offsetLessTimestamp } },
];

describe("consent record schemas (ARCHITECTURE.md §2.4)", () => {
  it.each(cases)("$name parses a valid sample", ({ schema, valid }) => {
    expect(schema.safeParse(valid).success).toBe(true);
  });

  it.each(cases)("$name rejects an invalid sample", ({ schema, invalid }) => {
    expect(schema.safeParse(invalid).success).toBe(false);
  });

  it("rejects an unknown consent type", () => {
    expect(consentRecordSchema.safeParse({ ...consentRecord, consentType: "consent_marketing" }).success).toBe(false);
  });

  it("parses a sign-up attestation without a video", () => {
    const attestation = {
      id: otherId,
      userId,
      textVersionId: "attestation-signup-v1",
      acceptedAt: timestamp,
      withdrawnAt: null,
      consentType: "attestation_signup",
    };
    expect(consentRecordSchema.safeParse(attestation).success).toBe(true);
  });

  describe("age confirmation record (HEN-263)", () => {
    const ageRecord = {
      id: otherId,
      userId,
      textVersionId: AGE_CONFIRMATION_TEXT_VERSION_ID,
      acceptedAt: timestamp,
      withdrawnAt: null,
      consentType: "age_confirmation",
      age16Confirmed: true,
      age18Confirmed: false,
    };

    it.each([false, true])("parses a record with age16Confirmed true and age18Confirmed %s", (age18Confirmed) => {
      expect(consentRecordSchema.safeParse({ ...ageRecord, age18Confirmed }).success).toBe(true);
      expect(ageConfirmationRecordSchema.safeParse({ ...ageRecord, age18Confirmed }).success).toBe(true);
    });

    it("rejects a record without the 16+ confirmation or without an 18+ answer", () => {
      expect(consentRecordSchema.safeParse({ ...ageRecord, age16Confirmed: false }).success).toBe(false);
      const withoutAge18: Partial<typeof ageRecord> = { ...ageRecord };
      delete withoutAge18.age18Confirmed;
      expect(consentRecordSchema.safeParse(withoutAge18).success).toBe(false);
    });

    it("has no birthdate or date-of-birth field: the record keeps only the two booleans", () => {
      const parsed = ageConfirmationRecordSchema.parse({ ...ageRecord, birthdate: "2000-01-01", dateOfBirth: "2000-01-01" });
      expect(Object.keys(parsed).sort()).toEqual(
        ["acceptedAt", "age16Confirmed", "age18Confirmed", "consentType", "id", "textVersionId", "userId", "withdrawnAt"].sort(),
      );
    });
  });
});
