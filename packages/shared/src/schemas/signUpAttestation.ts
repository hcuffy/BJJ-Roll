import { z } from "zod";
import { consentTextVersionIdSchema } from "./consentRecord.js";

// HEN-183 (M2-13): creating an account also needs the sign-up attestation, stored as an attestation_signup consent record
// (id, user id, text version id, accepted at). Only the text version id is stored, never the wording.
// The duties below are a DRAFT taken from the issue. The final wording waits on HEN-186 and the lawyer review (HEN-45);
// production refuses to start while the current version is a draft (serverConfig.ts).

export interface SignUpAttestationTextVersion {
  /** Stored on each record; bump it whenever the wording changes so every user accepts the new text. */
  readonly id: string;
  /** True until the wording is lawyer-reviewed. A draft version is fine in dev and test, never in production. */
  readonly isDraft: boolean;
}

export const SIGN_UP_ATTESTATION_TEXT_VERSION: SignUpAttestationTextVersion = { id: "attestation-signup-draft-1", isDraft: true };

/** DRAFT wording (HEN-186): the three duties, phrased as duties the user takes on, not as confessions (§309 Nr. 12 BGB). */
export const SIGN_UP_ATTESTATION_DUTIES = [
  "I will only upload rolls I took part in.",
  "I will only upload age-appropriate training footage.",
  "If I breach these duties, liability follows the Terms and the law.",
] as const;
export const SIGN_UP_ATTESTATION_LABEL = "I accept these duties";
export const SIGN_UP_ATTESTATION_REFUSAL_MESSAGE = "You must accept the sign-up duties to continue.";

/** GET /account/signup-attestation: `required` until the user accepted the current text version. */
export const signUpAttestationStatusSchema = z.strictObject({
  required: z.boolean(),
  currentTextVersionId: consentTextVersionIdSchema,
  acceptedTextVersionId: consentTextVersionIdSchema.nullable(),
});

export type SignUpAttestationStatus = z.infer<typeof signUpAttestationStatusSchema>;

/** POST /account/signup-attestation: the app sends the text version id it showed; the server accepts the current one only. */
export const signUpAttestationAcceptRequestSchema = z.strictObject({
  textVersionId: consentTextVersionIdSchema,
});

export type SignUpAttestationAcceptRequest = z.infer<typeof signUpAttestationAcceptRequestSchema>;

export function isCurrentSignUpAttestationTextVersion(textVersionId: unknown): boolean {
  return textVersionId === SIGN_UP_ATTESTATION_TEXT_VERSION.id;
}
