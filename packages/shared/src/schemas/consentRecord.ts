import { z } from "zod";
import { identifierSchema, timestampSchema } from "./common.js";

// ARCHITECTURE.md §2.4: consent record. No free text is stored; textVersionId points to a versioned, lawyer-reviewed text (M4-24, HEN-189).
export const consentRecipientTypeSchema = z.enum(["ai_vendor", "gym_mate", "reviewer"]);

const consentRecordBaseSchema = z.object({
  id: identifierSchema,
  userId: identifierSchema,
  textVersionId: z.string().min(1),
  acceptedAt: timestampSchema,
  withdrawnAt: timestampSchema.nullable(),
});

export const consentRecordSchema = z.discriminatedUnion("consentType", [
  consentRecordBaseSchema.extend({ consentType: z.literal("attestation_signup") }), // M2-13, HEN-183 (type name proposed)
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
