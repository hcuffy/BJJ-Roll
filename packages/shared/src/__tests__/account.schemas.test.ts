import { describe, expect, it } from "vitest";
import {
  accountDeletionCodeResponseSchema,
  accountDeletionRequestSchema,
  accountDeletionResponseSchema,
  accountExportSchema,
  adultConfirmationRequestSchema,
  AGE_CONFIRMATION_TEXT_VERSION_ID,
  ageConfirmationStatusSchema,
} from "../index.js";

const userId = "01964c3a-7f00-7000-8000-000000000001";
const timestamp = "2026-10-25T08:00:00.000Z";

const validExport = {
  exportedAt: timestamp,
  user: { id: userId, email: "member@example.test", handle: "roller_1", createdAt: timestamp, linkedProviders: [] },
  consentRecords: [
    {
      id: "01964c3a-7f00-7000-8000-000000000002",
      userId,
      consentType: "age_confirmation",
      textVersionId: AGE_CONFIRMATION_TEXT_VERSION_ID,
      age16Confirmed: true,
      age18Confirmed: false,
      acceptedAt: timestamp,
      withdrawnAt: null,
    },
  ],
};

describe("account export and deletion schemas (HEN-65)", () => {
  it("accepts an export with the user's id, email, handle and createdAt, and a null handle before one is set", () => {
    expect(accountExportSchema.parse(validExport)).toEqual(validExport);
    expect(accountExportSchema.parse({ ...validExport, user: { ...validExport.user, handle: null } }).user.handle).toBeNull();
  });

  it("rejects an export with extra user fields, so nothing beyond the listed M2 data leaks through", () => {
    expect(accountExportSchema.safeParse({ ...validExport, user: { ...validExport.user, emailHash: "abc" } }).success).toBe(false);
    expect(accountExportSchema.safeParse({ ...validExport, otherUsers: [] }).success).toBe(false);
  });

  it("rejects an export with a missing or malformed email, id or timestamp", () => {
    expect(accountExportSchema.safeParse({ ...validExport, user: { ...validExport.user, email: "not-an-email" } }).success).toBe(false);
    expect(accountExportSchema.safeParse({ ...validExport, user: { ...validExport.user, id: "user-1" } }).success).toBe(false);
    expect(accountExportSchema.safeParse({ ...validExport, exportedAt: "yesterday" }).success).toBe(false);
  });

  it("lists linked sign-in providers by name only (HEN-239)", () => {
    expect(
      accountExportSchema.parse({ ...validExport, user: { ...validExport.user, linkedProviders: ["apple", "google"] } }).user.linkedProviders,
    ).toEqual(["apple", "google"]);
    for (const linkedProviders of [["github"], [{ providerId: "google", accountId: "123" }], undefined]) {
      expect(accountExportSchema.safeParse({ ...validExport, user: { ...validExport.user, linkedProviders } }).success).toBe(false);
    }
  });

  it("accepts only deleted: true as the deletion response", () => {
    expect(accountDeletionResponseSchema.parse({ deleted: true })).toEqual({ deleted: true });
    expect(accountDeletionResponseSchema.safeParse({ deleted: false }).success).toBe(false);
    expect(accountDeletionResponseSchema.safeParse({ deleted: true, userId }).success).toBe(false);
  });

  it("accepts a delete request only with a 6-digit email code (Henry, 25 Oct: fresh code before delete)", () => {
    expect(accountDeletionRequestSchema.parse({ code: "012345" })).toEqual({ code: "012345" });
    for (const body of [{}, { code: "" }, { code: "12345" }, { code: "1234567" }, { code: "12a456" }, { code: 123456 }, { code: "123456", userId }]) {
      expect(accountDeletionRequestSchema.safeParse(body).success).toBe(false);
    }
  });

  it("accepts only sent: true as the delete-code response", () => {
    expect(accountDeletionCodeResponseSchema.parse({ sent: true })).toEqual({ sent: true });
    expect(accountDeletionCodeResponseSchema.safeParse({ sent: true, code: "123456" }).success).toBe(false);
  });

  it("requires the consent records in the export (HEN-263)", () => {
    const withoutConsentRecords: Partial<typeof validExport> = { ...validExport };
    delete withoutConsentRecords.consentRecords;
    expect(accountExportSchema.safeParse(withoutConsentRecords).success).toBe(false);
    expect(accountExportSchema.parse({ ...validExport, consentRecords: [] }).consentRecords).toEqual([]);
  });

  it("age confirmation status carries canPurchase next to both confirmations, nothing else (HEN-263)", () => {
    const status = { age16Confirmed: true, age18Confirmed: false, canPurchase: false };
    expect(ageConfirmationStatusSchema.parse(status)).toEqual(status);
    expect(ageConfirmationStatusSchema.safeParse({ ...status, birthdate: "2000-01-01" }).success).toBe(false);
  });

  it("the later 18+ confirmation accepts only age18Confirmed: true, so there is no way to un-confirm (HEN-263)", () => {
    expect(adultConfirmationRequestSchema.parse({ age18Confirmed: true })).toEqual({ age18Confirmed: true });
    for (const body of [{}, { age18Confirmed: false }, { age18Confirmed: "true" }, { age18Confirmed: true, userId }]) {
      expect(adultConfirmationRequestSchema.safeParse(body).success).toBe(false);
    }
  });
});
