import type { BiometricFailure, BiometricKind } from "../auth/biometricUnlock";

/** The words for each platform (Vera round 2, fix 2): iPhones say Face ID / Touch ID and passcode, Android says screen lock. */
export interface BiometricCopy {
  readonly offerTitle: string;
  readonly offerBody: string;
  /** Fix 7: the data never leaves the phone. */
  readonly offerPrivacy: string;
  /** Visible and spoken name of the Account toggle. */
  readonly toggleLabel: string;
  readonly toggleHint: string;
  /** Under the disabled toggle, and its screen-reader hint, when nothing is enrolled. */
  readonly setUpNote: string;
  readonly lockLine: string;
  readonly lockoutError: string;
  /** Lock screen: biometrics or the device passcode were removed, so Unlock cannot work. */
  readonly notSetUpError: string;
}

const iosCopy = (name: string): BiometricCopy => ({
  offerTitle: `Unlock BJJ Roll with ${name}?`,
  offerBody: `BJJ Roll will ask for ${name} or your passcode each time the app starts.`,
  offerPrivacy: `${name} stays on your phone. BJJ Roll never sees it.`,
  toggleLabel: name,
  toggleHint: `Asks for ${name} or your passcode when the app starts.`,
  setUpNote: `Set up ${name} in Settings to use this.`,
  lockLine: `Use ${name} or your passcode to unlock.`,
  lockoutError: "Too many tries. Use your passcode, or try again in a moment.",
  notSetUpError: `${name} isn't set up on this phone. Sign out, then sign in with your email.`,
});

const androidCopy: BiometricCopy = {
  offerTitle: "Unlock BJJ Roll with your fingerprint or face?",
  offerBody: "BJJ Roll will ask for your fingerprint, face or screen lock each time the app starts.",
  offerPrivacy: "Your fingerprint and face stay on your phone. BJJ Roll never sees them.",
  toggleLabel: "Biometric unlock",
  toggleHint: "Asks for your fingerprint, face or screen lock when the app starts.",
  setUpNote: "Add a fingerprint or face in your phone's Settings to use this.",
  lockLine: "Use your fingerprint, face or screen lock to unlock.",
  lockoutError: "Too many tries. Use your screen lock, or try again in a moment.",
  notSetUpError: "No fingerprint, face or screen lock is set up on this phone. Sign out, then sign in with your email.",
};

/** Fix 7: what turning it on is for, the same on every platform. */
export const BIOMETRIC_OFFER_BENEFIT = "Keeps anyone else using this phone out of your BJJ Roll account.";

/** Fix 3: under the lock screen's actions, so Sign out does not read as losing the account. */
export const BIOMETRIC_SIGN_OUT_NOTE = "Signing out keeps your account. You can sign back in with your email.";

/** Errors from a failed check on the offer and the toggle; cancelled shows none. */
export function biometricCheckError(failure: Exclude<BiometricFailure, "cancelled">, copy: BiometricCopy, failedMessage: string): string {
  if (failure === "lockout") {
    return copy.lockoutError;
  }
  return failure === "notSetUp" ? copy.setUpNote : failedMessage;
}

export const BIOMETRIC_COPY: Readonly<Record<BiometricKind, BiometricCopy>> = {
  faceId: iosCopy("Face ID"),
  touchId: iosCopy("Touch ID"),
  biometrics: androidCopy,
};
