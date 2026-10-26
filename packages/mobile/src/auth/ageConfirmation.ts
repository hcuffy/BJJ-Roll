import { AGE16_CONFIRMATION_LABEL, AGE18_CONFIRMATION_LABEL, age16ConfirmedSchema } from "@bjj-roll/shared";

// H5: 16+ only, self-declared; no birthdate is asked or stored. The backend refuses a new account unless the latest
// send carried `age16Confirmed: true` (HEN-77, HEN-263); the rule, labels and refusal message come from @bjj-roll/shared.
export { AGE_GATE_REFUSAL_MESSAGE } from "@bjj-roll/shared";
export const AGE_CONFIRMATION_LABEL = AGE16_CONFIRMATION_LABEL;
/** Optional, unticked by default; only 18+ accounts can buy (canPurchase). */
export const AGE_ADULT_CONFIRMATION_LABEL = AGE18_CONFIRMATION_LABEL;

export interface EmailEntry {
  readonly email: string;
  readonly age16Confirmed: boolean;
  readonly age18Confirmed?: boolean;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export function isEmailAddress(email: string): boolean {
  return EMAIL_PATTERN.test(email.trim());
}

/** True only for a ticked box, checked with the shared `age16ConfirmedSchema` the backend uses. */
export function isAgeConfirmed(entry: EmailEntry): boolean {
  return age16ConfirmedSchema.safeParse(entry.age16Confirmed).success;
}

/** Continue is enabled only when the 16+ box is ticked and the email looks valid. */
export function canContinue(entry: EmailEntry): boolean {
  return isAgeConfirmed(entry) && isEmailAddress(entry.email);
}
