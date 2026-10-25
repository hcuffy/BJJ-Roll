import { z } from "zod";

// HEN-77 (H5): creating an account needs a self-declared "I am 17 or older" tick. Only `true` passes; the answer is never stored.
export const AGE_GATE_REFUSAL_MESSAGE = "You must be 17 or older to use BJJ Roll.";

export const ageConfirmedSchema = z.literal(true, { error: AGE_GATE_REFUSAL_MESSAGE });

export const signUpRequestSchema = z.object({
  email: z.email(),
  ageConfirmed: ageConfirmedSchema,
});

export type SignUpRequest = z.infer<typeof signUpRequestSchema>;
