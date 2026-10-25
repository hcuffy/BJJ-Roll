import { describe, expect, it } from "vitest";
import { accountDeletionCodeResponseSchema, accountDeletionRequestSchema, accountDeletionResponseSchema, accountExportSchema } from "../index.js";

const userId = "01964c3a-7f00-7000-8000-000000000001";
const timestamp = "2026-10-25T08:00:00.000Z";

const validExport = {
  exportedAt: timestamp,
  user: { id: userId, email: "member@example.test", handle: "roller_1", createdAt: timestamp },
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
});
