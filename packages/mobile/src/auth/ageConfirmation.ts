import { AGE16_CONFIRMATION_LABEL, AGE18_CONFIRMATION_LABEL, age16ConfirmedSchema } from "@bjj-roll/shared";
import { ATTESTATION_NEEDED_HINT } from "./signUpAttestation";

export { AGE_GATE_REFUSAL_MESSAGE } from "@bjj-roll/shared";
export const AGE_CONFIRMATION_LABEL = AGE16_CONFIRMATION_LABEL;
export const AGE_ADULT_CONFIRMATION_LABEL = AGE18_CONFIRMATION_LABEL;
export const AGE_ADULT_CONFIRMATION_NOTE = "Only needed to buy things later. Already have an account? Confirm in Account.";
export const AGE_ADULT_NEEDS_16_HINT = "Tick I am 16 or older first.";

export interface AgeAnswers {
  readonly age16Confirmed: boolean;
  readonly age18Confirmed?: boolean;
  readonly signUpAttestationAccepted?: boolean;
}

export interface EmailEntry extends AgeAnswers {
  readonly email: string;
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export function isEmailAddress(email: string): boolean {
  return emailPattern.test(email.trim());
}

export function isAgeConfirmed(entry: AgeAnswers): boolean {
  return age16ConfirmedSchema.safeParse(entry.age16Confirmed).success;
}

export function isSignUpAttestationAccepted(entry: AgeAnswers): boolean {
  return entry.signUpAttestationAccepted === true;
}

export function canContinue(entry: EmailEntry): boolean {
  return isAgeConfirmed(entry) && isEmailAddress(entry.email);
}

export function missingHint(emailValid: boolean, age16Confirmed: boolean, attestationAccepted = true): string | undefined {
  if (!emailValid && !age16Confirmed) {
    return "Enter your email and tick the 16 or older box first.";
  }
  if (!emailValid) {
    return "Enter your email first.";
  }
  if (!age16Confirmed) {
    return "Tick the 16 or older box first.";
  }
  return attestationAccepted ? undefined : ATTESTATION_NEEDED_HINT;
}
