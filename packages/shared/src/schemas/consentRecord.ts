import { z } from "zod";
import { identifierSchema, timestampSchema } from "./common.js";

// ARCHITECTURE.md §2.4: consent record. No free text is stored; textVersionId points to a versioned, lawyer-reviewed text (M4-24, HEN-189).
export const consentRecipientTypeSchema = z.enum(["ai_vendor", "gym_mate", "reviewer"]);

/** Names a versioned text; the wording itself is never stored. */
export const consentTextVersionIdSchema = z.string().min(1).max(100);

const consentRecordBaseSchema = z.object({
  id: identifierSchema,
  userId: identifierSchema,
  textVersionId: consentTextVersionIdSchema,
  acceptedAt: timestampSchema,
  withdrawnAt: timestampSchema.nullable(),
});

/** HEN-263: the sign-up age answers, and a later 18+ confirmation from settings as a new record. Never updated in place. */
export const ageConfirmationRecordSchema = consentRecordBaseSchema.extend({
  consentType: z.literal("age_confirmation"),
  age16Confirmed: z.literal(true),
  age18Confirmed: z.boolean(),
});

/** HEN-183 (M2-13): the sign-up attestation. Strict: no age answers and no free text on this record. */
export const signUpAttestationRecordSchema = z.strictObject({
  ...consentRecordBaseSchema.shape,
  consentType: z.literal("attestation_signup"),
});

export const consentRecordSchema = z.discriminatedUnion("consentType", [
  ageConfirmationRecordSchema,
  signUpAttestationRecordSchema,
  consentRecordBaseSchema.extend({ consentType: z.literal("attestation_upload"), videoId: identifierSchema }), // M4-25, HEN-190
  consentRecordBaseSchema.extend({ consentType: z.literal("attestation_share"), videoId: identifierSchema }), // M6-11 (type name proposed)
  consentRecordBaseSchema.extend({ consentType: z.literal("attestation_review_request"), videoId: identifierSchema }), // M10-09 (type name proposed)
  consentRecordBaseSchema.extend({
    consentType: z.literal("consent_third_party"), // Apple 5.1.2(i): before footage goes to the AI vendor, a gym mate or a reviewer
    videoId: identifierSchema,
    recipientType: consentRecipientTypeSchema,
    recipientUserId: identifierSchema.nullable(), // null for "ai_vendor"
  }),
  consentRecordBaseSchema.extend({ consentType: z.literal("consent_training_opt_in") }), // D7, M8-02 (type name proposed)
  consentRecordBaseSchema.extend({ consentType: z.literal("consent_person_in_video"), videoId: identifierSchema }), // HEN-69 (type name proposed)
]);

export type ConsentRecipientType = z.infer<typeof consentRecipientTypeSchema>;
export type ConsentRecord = z.infer<typeof consentRecordSchema>;
export type AgeConfirmationRecord = z.infer<typeof ageConfirmationRecordSchema>;
export type SignUpAttestationRecord = z.infer<typeof signUpAttestationRecordSchema>;
