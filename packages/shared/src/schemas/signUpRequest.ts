import { z } from "zod";

// HEN-77 (H5), 16+ since HEN-263: creating an account needs a self-declared "I am 16 or older" tick. Only `true` passes.
// The optional "I am 18 or older" box is a separate answer, unticked by default. Both answers are stored on the user's
// age_confirmation consent record with AGE_CONFIRMATION_TEXT_VERSION_ID and a timestamp; there is no birthdate field.
export const MINIMUM_SIGN_UP_AGE = 16;
export const AGE_GATE_REFUSAL_MESSAGE = "You must be 16 or older to sign up.";
export const AGE16_CONFIRMATION_LABEL = "I am 16 or older";
export const AGE18_CONFIRMATION_LABEL = "I am 18 or older";
/** Names the wording above; bump it whenever either label changes so each record points at the text the user saw. */
export const AGE_CONFIRMATION_TEXT_VERSION_ID = "age-confirmation-v1";

/** HEN-263: a failed magic link opens `bjjroll://auth?r=<reason>` with a fixed code only; the app shows its own copy for each code. */
export const MAGIC_LINK_REASON_PARAM = "r";
export const MAGIC_LINK_REASONS = { ageRefused: "age_refused", attestationRefused: "attestation_refused", linkInvalid: "link_invalid" } as const;
export type MagicLinkReason = (typeof MAGIC_LINK_REASONS)[keyof typeof MAGIC_LINK_REASONS];

export const age16ConfirmedSchema = z.literal(true, { error: AGE_GATE_REFUSAL_MESSAGE });

export const signUpRequestSchema = z.object({
  email: z.email(),
  age16Confirmed: age16ConfirmedSchema,
  age18Confirmed: z.boolean().optional(),
});

export type SignUpRequest = z.infer<typeof signUpRequestSchema>;
