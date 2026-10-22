import { describe, expect, it } from "vitest";
import { accessGrantKindSchema, accessGrantRevocationReasonSchema, accessGrantSchema, accessGrantScopeSchema } from "../index.js";
import { invalidIdentifier, otherId, timestamp, userId, videoId } from "./sampleValues.js";

const accessGrant = {
  id: otherId,
  videoId,
  ownerId: userId,
  granteeId: otherId,
  kind: "gym_mate",
  scope: "note",
  reviewRequestId: null,
  createdAt: timestamp,
  expiresAt: null,
  revokedAt: null,
  revocationReason: null,
};

const cases = [
  { name: "accessGrantKindSchema", schema: accessGrantKindSchema, valid: "reviewer", invalid: "coach" },
  { name: "accessGrantScopeSchema", schema: accessGrantScopeSchema, valid: "view", invalid: "edit" },
  { name: "accessGrantRevocationReasonSchema", schema: accessGrantRevocationReasonSchema, valid: "user_blocked", invalid: "expired" },
  { name: "accessGrantSchema", schema: accessGrantSchema, valid: accessGrant, invalid: { ...accessGrant, granteeId: invalidIdentifier } },
];

describe("access grant schemas (ARCHITECTURE.md §2.3)", () => {
  it.each(cases)("$name parses a valid sample", ({ schema, valid }) => {
    expect(schema.safeParse(valid).success).toBe(true);
  });

  it.each(cases)("$name rejects an invalid sample", ({ schema, invalid }) => {
    expect(schema.safeParse(invalid).success).toBe(false);
  });
});
