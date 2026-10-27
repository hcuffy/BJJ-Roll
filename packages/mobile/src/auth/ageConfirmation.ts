import { AGE16_CONFIRMATION_LABEL, AGE18_CONFIRMATION_LABEL, age16ConfirmedSchema } from "@bjj-roll/shared";

// H5: 16+ only, self-declared; no birthdate is asked or stored. The backend refuses a new account unless the latest
// send carried `age16Confirmed: true` (HEN-77, HEN-263); the rule, labels and refusal message come from @bjj-roll/shared.
export { AGE_GATE_REFUSAL_MESSAGE } from "@bjj-roll/shared";
export const AGE_CONFIRMATION_LABEL = AGE16_CONFIRMATION_LABEL;
/**
 * Optional, unticked by default; only 18+ accounts can buy (canPurchase). The on-screen name is exactly the shared
 * AGE18_CONFIRMATION_LABEL that the consent record's text version names (Henry, 27 Oct: no "(optional)" suffix).
 */
export const AGE_ADULT_CONFIRMATION_LABEL = AGE18_CONFIRMATION_LABEL;
/** Muted note under the 18+ box. Sign-up only reads it for new accounts, so point signed-up users to Account (Vera item 3, Henry Q3). */
export const AGE_ADULT_CONFIRMATION_NOTE = "Only needed to buy things later. Already have an account? Confirm in Account.";
/** Hint for the 18+ box while it is disabled: it can only be ticked after the 16+ box (Vera item 2). */
export const AGE_ADULT_NEEDS_16_HINT = "Tick I am 16 or older first.";
/** Second line of the link error card after an age refusal: the link is used up, so say what to do next (Vera delta item 2). */
export const AGE_LINK_REFUSAL_NEXT_STEP = "Tick I am 16 or older and send a new link.";

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
