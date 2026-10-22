import { z } from "zod";
import { identifierSchema, timestampSchema } from "./common.js";

// ARCHITECTURE.md §2.3: access grant.
export const accessGrantKindSchema = z.enum(["gym_mate", "reviewer"]);
export const accessGrantScopeSchema = z.enum(["view", "note"]); // "note" includes "view"

export const accessGrantRevocationReasonSchema = z.enum([
  "owner_revoked",
  "user_blocked", // M6-16, HEN-199
  "review_delivered", // M10-10, HEN-212
  "account_deleted",
]);

export const accessGrantSchema = z.object({
  id: identifierSchema,
  videoId: identifierSchema,
  ownerId: identifierSchema,
  granteeId: identifierSchema,
  kind: accessGrantKindSchema,
  scope: accessGrantScopeSchema,
  reviewRequestId: identifierSchema.nullable(), // set for kind "reviewer"
  createdAt: timestampSchema,
  expiresAt: timestampSchema.nullable(), // null only if Henry decides gym-mate shares last until revoked (HEN-192)
  revokedAt: timestampSchema.nullable(),
  revocationReason: accessGrantRevocationReasonSchema.nullable(),
});

export type AccessGrantKind = z.infer<typeof accessGrantKindSchema>;
export type AccessGrantScope = z.infer<typeof accessGrantScopeSchema>;
export type AccessGrantRevocationReason = z.infer<typeof accessGrantRevocationReasonSchema>;
export type AccessGrant = z.infer<typeof accessGrantSchema>;
