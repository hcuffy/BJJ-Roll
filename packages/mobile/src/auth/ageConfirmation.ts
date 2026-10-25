import { ageConfirmedSchema } from "@bjj-roll/shared";

// H5: 17+ only, self-declared, never stored. The backend refuses new accounts without `ageConfirmed: true` (HEN-77);
// the rule and its refusal message come from @bjj-roll/shared.
export { AGE_GATE_REFUSAL_MESSAGE } from "@bjj-roll/shared";
export const AGE_CONFIRMATION_LABEL = "I am 17 or older";

export interface EmailEntry {
  readonly email: string;
  readonly ageConfirmed: boolean;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export function isEmailAddress(email: string): boolean {
  return EMAIL_PATTERN.test(email.trim());
}

/** True only for a ticked box, checked with the shared `ageConfirmedSchema` the backend uses. */
export function isAgeConfirmed(entry: EmailEntry): boolean {
  return ageConfirmedSchema.safeParse(entry.ageConfirmed).success;
}

/** Continue is enabled only when the 17+ box is ticked and the email looks valid. */
export function canContinue(entry: EmailEntry): boolean {
  return isAgeConfirmed(entry) && isEmailAddress(entry.email);
}
