import { z } from "zod";

export const MINIMUM_SIGN_UP_AGE = 16;
export const AGE_GATE_REFUSAL_MESSAGE = "You must be 16 or older to sign up.";
export const AGE16_CONFIRMATION_LABEL = "I am 16 or older";
export const AGE18_CONFIRMATION_LABEL = "I am 18 or older";
export const AGE_CONFIRMATION_TEXT_VERSION_ID = "age-confirmation-v1";

export const MAGIC_LINK_REASON_PARAM = "r";
export const magicLinkReasons = { ageRefused: "age_refused", attestationRefused: "attestation_refused", linkInvalid: "link_invalid" } as const;
export type MagicLinkReason = (typeof magicLinkReasons)[keyof typeof magicLinkReasons];

export const age16ConfirmedSchema = z.literal(true, { error: AGE_GATE_REFUSAL_MESSAGE });

export const signUpRequestSchema = z.object({
  email: z.email(),
  age16Confirmed: age16ConfirmedSchema,
  age18Confirmed: z.boolean().optional(),
});

export type SignUpRequest = z.infer<typeof signUpRequestSchema>;
