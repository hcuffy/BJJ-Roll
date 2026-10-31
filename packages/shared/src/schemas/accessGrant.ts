import { z } from "zod";
import { identifierSchema, timestampSchema } from "./common.js";

export const accessGrantKindSchema = z.enum(["gym_mate", "reviewer"]);
export const accessGrantScopeSchema = z.enum(["view", "note"]);

export const accessGrantRevocationReasonSchema = z.enum(["owner_revoked", "user_blocked", "review_delivered", "account_deleted"]);

export const accessGrantSchema = z.object({
  id: identifierSchema,
  videoId: identifierSchema,
  ownerId: identifierSchema,
  granteeId: identifierSchema,
  kind: accessGrantKindSchema,
  scope: accessGrantScopeSchema,
  reviewRequestId: identifierSchema.nullable(),
  createdAt: timestampSchema,
  expiresAt: timestampSchema.nullable(),
  revokedAt: timestampSchema.nullable(),
  revocationReason: accessGrantRevocationReasonSchema.nullable(),
});

export type AccessGrantKind = z.infer<typeof accessGrantKindSchema>;
export type AccessGrantScope = z.infer<typeof accessGrantScopeSchema>;
export type AccessGrantRevocationReason = z.infer<typeof accessGrantRevocationReasonSchema>;
export type AccessGrant = z.infer<typeof accessGrantSchema>;
