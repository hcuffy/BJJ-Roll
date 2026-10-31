import { z } from "zod";
import { identifierSchema, timestampSchema } from "./common.js";
import { ageConfirmationRecordSchema, signUpAttestationRecordSchema } from "./consentRecord.js";
import { handleSchema } from "./handle.js";

export const socialProviderNames = ["apple", "google"] as const;
export const socialProviderNameSchema = z.enum(socialProviderNames);
export type SocialProviderName = z.infer<typeof socialProviderNameSchema>;

export const accountExportSchema = z.strictObject({
  exportedAt: timestampSchema,
  user: z.strictObject({
    id: identifierSchema,
    email: z.email(),
    handle: handleSchema.nullable(),
    createdAt: timestampSchema,
    linkedProviders: z.array(socialProviderNameSchema),
  }),
  consentRecords: z.array(z.discriminatedUnion("consentType", [ageConfirmationRecordSchema, signUpAttestationRecordSchema])),
});

export type AccountExport = z.infer<typeof accountExportSchema>;

export const accountDeletionResponseSchema = z.strictObject({
  deleted: z.literal(true),
});

export type AccountDeletionResponse = z.infer<typeof accountDeletionResponseSchema>;

export const accountDeletionRequestSchema = z.strictObject({
  code: z.string().regex(/^\d{6}$/u),
});

export type AccountDeletionRequest = z.infer<typeof accountDeletionRequestSchema>;

export const accountDeletionCodeResponseSchema = z.strictObject({
  sent: z.literal(true),
});

export type AccountDeletionCodeResponse = z.infer<typeof accountDeletionCodeResponseSchema>;

export const ageConfirmationStatusSchema = z.strictObject({
  age16Confirmed: z.boolean(),
  age18Confirmed: z.boolean(),
  canPurchase: z.boolean(),
});

export type AgeConfirmationStatus = z.infer<typeof ageConfirmationStatusSchema>;

export const adultConfirmationRequestSchema = z.strictObject({
  age18Confirmed: z.literal(true),
});

export type AdultConfirmationRequest = z.infer<typeof adultConfirmationRequestSchema>;
