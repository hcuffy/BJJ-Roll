import * as LocalAuthentication from "expo-local-authentication";
import { Platform } from "react-native";
import { SESSION_STORAGE_PREFIX } from "./authClient";
import type { SessionKeyStore } from "./signInActions";

// Privacy (HEN-288): the phone keeps only two on/off flags in SecureStore. Fingerprints and faces stay inside the OS prompt;
// the app only learns success or failure, and nothing about biometric unlock is sent to the server.

/** "on" while biometric unlock is turned on; sign-out and account delete remove it. */
export const BIOMETRIC_UNLOCK_KEY = `${SESSION_STORAGE_PREFIX}_biometric_unlock`;
/** Set once the offer after sign-in was shown; stays on this install, so the offer is never repeated. */
export const BIOMETRIC_OFFERED_KEY = `${SESSION_STORAGE_PREFIX}_biometric_offered`;

/** Which words the screens use: Face ID or Touch ID on an iPhone, the generic fingerprint / face / screen lock on Android. */
export type BiometricKind = "faceId" | "touchId" | "biometrics";

/** The settings toggle: off and disabled when the phone has no fingerprint or face enrolled. */
export type BiometricSetting =
  { readonly available: false; readonly kind: BiometricKind } | { readonly available: true; readonly on: boolean; readonly kind: BiometricKind };

/**
 * Why a check failed. cancelled is the user's own choice, so the screen shows no error for it; lockout (too many tries) and
 * notSetUp (biometrics or the passcode were removed) get their own message, so nobody taps Unlock in a loop.
 */
export type BiometricFailure = "cancelled" | "lockout" | "notSetUp" | "failed";

export type BiometricCheck = { readonly ok: true } | { readonly ok: false; readonly failure: BiometricFailure };

const FAILURES: Partial<Record<LocalAuthentication.LocalAuthenticationError, BiometricFailure>> = {
  user_cancel: "cancelled",
  system_cancel: "cancelled",
  app_cancel: "cancelled",
  lockout: "lockout",
  not_enrolled: "notSetUp",
  passcode_not_set: "notSetUp",
  not_available: "notSetUp",
};

/** Never rejects; an iPhone that reports no sensor gets the Face ID words, as most iPhones have it. */
export async function readBiometricKind(): Promise<BiometricKind> {
  if (Platform.OS !== "ios") {
    return "biometrics";
  }
  const types = await LocalAuthentication.supportedAuthenticationTypesAsync().catch((): LocalAuthentication.AuthenticationType[] => []);
  const touchIdOnly =
    types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT) && !types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
  return touchIdOnly ? "touchId" : "faceId";
}

async function isBiometricEnrolled(): Promise<boolean> {
  try {
    return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
  } catch {
    return false;
  }
}

/** Opens the OS prompt; the device PIN is allowed as a fallback. Never rejects. */
export async function checkBiometric(promptMessage: string): Promise<BiometricCheck> {
  try {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage, disableDeviceFallback: false });
    return result.success ? { ok: true } : { ok: false, failure: FAILURES[result.error] ?? "failed" };
  } catch {
    return { ok: false, failure: "failed" };
  }
}

/** Whether launch must ask for the check first. A store that cannot be read counts as on: sign-out is always offered. */
export async function isBiometricUnlockOn(secureStore: SessionKeyStore): Promise<boolean> {
  try {
    return (await secureStore.getItemAsync(BIOMETRIC_UNLOCK_KEY)) === "on";
  } catch {
    return true;
  }
}

export async function readBiometricSetting(secureStore: SessionKeyStore): Promise<BiometricSetting> {
  const kind = await readBiometricKind();
  if (!(await isBiometricEnrolled())) {
    return { available: false, kind };
  }
  return { available: true, on: await isBiometricUnlockOn(secureStore), kind };
}

/**
 * Call after a sign-in: the words to use when the offer should show now, otherwise null.
 * It shows once per install, and only on a phone with biometrics.
 * It is marked as shown first, so a marker that cannot be saved means no offer rather than a repeated one.
 */
export async function takeBiometricOffer(secureStore: SessionKeyStore): Promise<BiometricKind | null> {
  if ((await secureStore.getItemAsync(BIOMETRIC_OFFERED_KEY).catch(() => "1")) !== null || !(await isBiometricEnrolled())) {
    return null;
  }
  const marked = await secureStore.setItemAsync(BIOMETRIC_OFFERED_KEY, "1").then(
    () => true,
    () => false,
  );
  return marked ? await readBiometricKind() : null;
}

/** Turning on needs a successful check first; turning off needs none. Rejects only when SecureStore cannot be written. */
export async function changeBiometricUnlock(secureStore: SessionKeyStore, on: boolean): Promise<BiometricCheck> {
  if (!on) {
    await secureStore.deleteItemAsync(BIOMETRIC_UNLOCK_KEY);
    return { ok: true };
  }
  const check = await checkBiometric("Turn on biometric unlock");
  if (check.ok) {
    await secureStore.setItemAsync(BIOMETRIC_UNLOCK_KEY, "on");
  }
  return check;
}

/** On sign-out and account delete. Never rejects. */
export async function clearBiometricUnlock(secureStore: SessionKeyStore): Promise<void> {
  await secureStore.deleteItemAsync(BIOMETRIC_UNLOCK_KEY).catch(() => undefined);
}
