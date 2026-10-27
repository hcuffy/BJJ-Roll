import { z } from "zod";
import { identifierSchema, timestampSchema } from "./common.js";
import { ageConfirmationRecordSchema } from "./consentRecord.js";
import { handleSchema } from "./handle.js";

/**
 * GET /account/export (HEN-65): everything M2 stores about the signed-in user, and nothing else.
 * Later features add their own keys next to `user` when they ship (ARCHITECTURE.md §5).
 */
export const accountExportSchema = z.strictObject({
  exportedAt: timestampSchema,
  user: z.strictObject({
    id: identifierSchema,
    email: z.email(),
    handle: handleSchema.nullable(),
    createdAt: timestampSchema,
  }),
  consentRecords: z.array(ageConfirmationRecordSchema), // HEN-263: deleted with the account, exported like HEN-183
});

export type AccountExport = z.infer<typeof accountExportSchema>;

/** DELETE /account (HEN-65): the account and every M2 row for it are gone. */
export const accountDeletionResponseSchema = z.strictObject({
  deleted: z.literal(true),
});

export type AccountDeletionResponse = z.infer<typeof accountDeletionResponseSchema>;

/** DELETE /account body (HEN-65, Henry 25 Oct): the fresh 6-digit code from the delete-code email, and nothing else. */
export const accountDeletionRequestSchema = z.strictObject({
  code: z.string().regex(/^\d{6}$/u),
});

export type AccountDeletionRequest = z.infer<typeof accountDeletionRequestSchema>;

/** POST /account/delete-code: a deletion code was emailed to the signed-in user's own address. */
export const accountDeletionCodeResponseSchema = z.strictObject({
  sent: z.literal(true),
});

export type AccountDeletionCodeResponse = z.infer<typeof accountDeletionCodeResponseSchema>;

/** GET /account/age-confirmation (HEN-263): canPurchase is age18Confirmed; under-18 accounts stay on the free tier. */
export const ageConfirmationStatusSchema = z.strictObject({
  age16Confirmed: z.boolean(),
  age18Confirmed: z.boolean(),
  canPurchase: z.boolean(),
});

export type AgeConfirmationStatus = z.infer<typeof ageConfirmationStatusSchema>;

/** POST /account/age-confirmation body (HEN-263): only a later 18+ confirmation. Deleting the account is the only way back. */
export const adultConfirmationRequestSchema = z.strictObject({
  age18Confirmed: z.literal(true),
});

export type AdultConfirmationRequest = z.infer<typeof adultConfirmationRequestSchema>;
