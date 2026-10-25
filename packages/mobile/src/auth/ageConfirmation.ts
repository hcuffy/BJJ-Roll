// H5: 17+ only, self-declared, never stored. The backend refuses new accounts without `ageConfirmed: true` (HEN-77).
// TODO(HEN-77): import the `ageConfirmed` field from `@bjj-roll/shared` once HEN-77 is on main.
export const AGE_CONFIRMATION_LABEL = "I am 17 or older";
export const AGE_REQUIRED_MESSAGE = "You must be 17 or older to use BJJ Roll.";

export interface EmailEntry {
  readonly email: string;
  readonly ageConfirmed: boolean;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export function isEmailAddress(email: string): boolean {
  return EMAIL_PATTERN.test(email.trim());
}

/** Continue is enabled only when the 17+ box is ticked and the email looks valid. */
export function canContinue(entry: EmailEntry): boolean {
  return entry.ageConfirmed && isEmailAddress(entry.email);
}
