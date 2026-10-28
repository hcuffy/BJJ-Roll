import * as LocalAuthentication from "expo-local-authentication";
import { SESSION_STORAGE_PREFIX } from "./authClient";
import type { SessionKeyStore } from "./signInActions";

// Privacy (HEN-288): the phone keeps only two on/off flags in SecureStore. Fingerprints and faces stay inside the OS prompt;
// the app only learns success or failure, and nothing about biometric unlock is sent to the server.

/** "on" while biometric unlock is turned on; sign-out and account delete remove it. */
export const BIOMETRIC_UNLOCK_KEY = `${SESSION_STORAGE_PREFIX}_biometric_unlock`;
/** Set once the offer after sign-in was shown; stays on this install, so the offer is never repeated. */
export const BIOMETRIC_OFFERED_KEY = `${SESSION_STORAGE_PREFIX}_biometric_offered`;

/** The settings toggle: off and disabled when the phone has no fingerprint or face enrolled. */
export type BiometricSetting = { readonly available: false } | { readonly available: true; readonly on: boolean };

/** A biometric (or device PIN) check: cancelled is the user's own choice, so the screen shows no error for it. */
export type BiometricCheck = { readonly ok: true } | { readonly ok: false; readonly cancelled: boolean };

const CANCEL_ERRORS = new Set<LocalAuthentication.LocalAuthenticationError>(["user_cancel", "system_cancel", "app_cancel"]);

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
    return result.success ? { ok: true } : { ok: false, cancelled: CANCEL_ERRORS.has(result.error) };
  } catch {
    return { ok: false, cancelled: false };
  }
}

/** Whether launch must ask for the check first. A store that cannot be read counts as on: sign-out is always offered. */
export async function isBiometricUnlockOn(secureStore: SessionKeyStore): Promise<boolean> {
  return (await secureStore.getItemAsync(BIOMETRIC_UNLOCK_KEY).catch(() => "on")) === "on";
}

export async function readBiometricSetting(secureStore: SessionKeyStore): Promise<BiometricSetting> {
  if (!(await isBiometricEnrolled())) {
    return { available: false };
  }
  return { available: true, on: await isBiometricUnlockOn(secureStore) };
}

/**
 * Call after a sign-in: true when the offer should show now. It shows once per install, and only on a phone with biometrics;
 * it is marked as shown first, so a marker that cannot be saved means no offer rather than a repeated one.
 */
export async function takeBiometricOffer(secureStore: SessionKeyStore): Promise<boolean> {
  if ((await secureStore.getItemAsync(BIOMETRIC_OFFERED_KEY).catch(() => "1")) !== null || !(await isBiometricEnrolled())) {
    return false;
  }
  return await secureStore.setItemAsync(BIOMETRIC_OFFERED_KEY, "1").then(
    () => true,
    () => false,
  );
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
