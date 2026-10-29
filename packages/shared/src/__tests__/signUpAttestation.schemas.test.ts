import { describe, expect, it } from "vitest";
import {
  accountExportSchema,
  isCurrentSignUpAttestationTextVersion,
  SIGN_UP_ATTESTATION_DUTIES,
  SIGN_UP_ATTESTATION_TEXT_VERSION,
  signUpAttestationAcceptRequestSchema,
  signUpAttestationRecordSchema,
  signUpAttestationStatusSchema,
} from "../index.js";
import { otherId, timestamp, userId } from "./sampleValues.js";

const attestationRecord = {
  id: otherId,
  userId,
  consentType: "attestation_signup",
  textVersionId: SIGN_UP_ATTESTATION_TEXT_VERSION.id,
  acceptedAt: timestamp,
  withdrawnAt: null,
};

describe("HEN-183 sign-up attestation schemas", () => {
  it("names three duties and a draft text version", () => {
    expect(SIGN_UP_ATTESTATION_DUTIES).toHaveLength(3);
    expect(SIGN_UP_ATTESTATION_TEXT_VERSION).toEqual({ id: "attestation-signup-draft-1", isDraft: true });
  });

  it("a record holds the consent type, text version id, accepted-at, user id, id and withdrawn-at only", () => {
    expect(signUpAttestationRecordSchema.parse(attestationRecord)).toEqual(attestationRecord);
    expect(signUpAttestationRecordSchema.safeParse({ ...attestationRecord, age16Confirmed: true }).success).toBe(false);
    expect(signUpAttestationRecordSchema.safeParse({ ...attestationRecord, text: "I will only upload rolls I took part in." }).success).toBe(false);
    expect(signUpAttestationRecordSchema.safeParse({ ...attestationRecord, textVersionId: "" }).success).toBe(false);
  });

  it("the export carries attestation records next to age confirmation records", () => {
    const exported = {
      exportedAt: timestamp,
      user: { id: userId, email: "member@example.test", handle: null, createdAt: timestamp, linkedProviders: [] },
      consentRecords: [attestationRecord],
    };
    expect(accountExportSchema.parse(exported)).toEqual(exported);
  });

  it("status and accept bodies are strict", () => {
    const status = { required: true, currentTextVersionId: SIGN_UP_ATTESTATION_TEXT_VERSION.id, acceptedTextVersionId: null };
    expect(signUpAttestationStatusSchema.parse(status)).toEqual(status);
    expect(signUpAttestationAcceptRequestSchema.safeParse({ textVersionId: SIGN_UP_ATTESTATION_TEXT_VERSION.id }).success).toBe(true);
    expect(signUpAttestationAcceptRequestSchema.safeParse({ textVersionId: SIGN_UP_ATTESTATION_TEXT_VERSION.id, accepted: true }).success).toBe(
      false,
    );
    expect(signUpAttestationAcceptRequestSchema.safeParse({}).success).toBe(false);
  });

  it("only the current text version id counts as current", () => {
    expect(isCurrentSignUpAttestationTextVersion(SIGN_UP_ATTESTATION_TEXT_VERSION.id)).toBe(true);
    expect(isCurrentSignUpAttestationTextVersion("attestation-signup-draft-0")).toBe(false);
    expect(isCurrentSignUpAttestationTextVersion(undefined)).toBe(false);
    expect(isCurrentSignUpAttestationTextVersion(true)).toBe(false);
  });
});
