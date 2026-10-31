import { z } from "zod";
import { identifierSchema, timestampSchema } from "./common.js";

export const consentRecipientTypeSchema = z.enum(["ai_vendor", "gym_mate", "reviewer"]);

export const consentTextVersionIdSchema = z.string().min(1).max(100);

const consentRecordBaseSchema = z.object({
  id: identifierSchema,
  userId: identifierSchema,
  textVersionId: consentTextVersionIdSchema,
  acceptedAt: timestampSchema,
  withdrawnAt: timestampSchema.nullable(),
});

export const ageConfirmationRecordSchema = consentRecordBaseSchema.extend({
  consentType: z.literal("age_confirmation"),
  age16Confirmed: z.literal(true),
  age18Confirmed: z.boolean(),
});

export const signUpAttestationRecordSchema = z.strictObject({
  ...consentRecordBaseSchema.shape,
  consentType: z.literal("attestation_signup"),
});

export const consentRecordSchema = z.discriminatedUnion("consentType", [
  ageConfirmationRecordSchema,
  signUpAttestationRecordSchema,
  consentRecordBaseSchema.extend({ consentType: z.literal("attestation_upload"), videoId: identifierSchema }),
  consentRecordBaseSchema.extend({ consentType: z.literal("attestation_share"), videoId: identifierSchema }),
  consentRecordBaseSchema.extend({ consentType: z.literal("attestation_review_request"), videoId: identifierSchema }),
  consentRecordBaseSchema.extend({
    consentType: z.literal("consent_third_party"),
    videoId: identifierSchema,
    recipientType: consentRecipientTypeSchema,
    recipientUserId: identifierSchema.nullable(),
  }),
  consentRecordBaseSchema.extend({ consentType: z.literal("consent_training_opt_in") }),
  consentRecordBaseSchema.extend({ consentType: z.literal("consent_person_in_video"), videoId: identifierSchema }),
]);

export type ConsentRecipientType = z.infer<typeof consentRecipientTypeSchema>;
export type ConsentRecord = z.infer<typeof consentRecordSchema>;
export type AgeConfirmationRecord = z.infer<typeof ageConfirmationRecordSchema>;
export type SignUpAttestationRecord = z.infer<typeof signUpAttestationRecordSchema>;
