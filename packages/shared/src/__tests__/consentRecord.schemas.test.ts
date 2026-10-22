import { describe, expect, it } from "vitest";
import { consentRecipientTypeSchema, consentRecordSchema } from "../index.js";
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
});
