import { z } from "zod";
import { consentTextVersionIdSchema } from "./consentRecord.js";

export interface SignUpAttestationTextVersion {
  readonly id: string;
  readonly isDraft: boolean;
}

export const SIGN_UP_ATTESTATION_TEXT_VERSION: SignUpAttestationTextVersion = { id: "attestation-signup-draft-1", isDraft: true };

export const SIGN_UP_ATTESTATION_DUTIES = [
  "I will only upload rolls I took part in.",
  "I will only upload age-appropriate training footage.",
  "If I breach these duties, liability follows the Terms and the law.",
] as const;
export const SIGN_UP_ATTESTATION_LABEL = "I accept these duties";
export const SIGN_UP_ATTESTATION_REFUSAL_MESSAGE = "Tick the box to accept the duties.";

export const signUpAttestationStatusSchema = z.strictObject({
  required: z.boolean(),
  currentTextVersionId: consentTextVersionIdSchema,
  acceptedTextVersionId: consentTextVersionIdSchema.nullable(),
});

export type SignUpAttestationStatus = z.infer<typeof signUpAttestationStatusSchema>;

export const signUpAttestationAcceptRequestSchema = z.strictObject({
  textVersionId: consentTextVersionIdSchema,
});

export type SignUpAttestationAcceptRequest = z.infer<typeof signUpAttestationAcceptRequestSchema>;

export function isCurrentSignUpAttestationTextVersion(textVersionId: unknown): boolean {
  return textVersionId === SIGN_UP_ATTESTATION_TEXT_VERSION.id;
}
