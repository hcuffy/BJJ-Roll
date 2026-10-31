import * as LocalAuthentication from "expo-local-authentication";
import { Platform } from "react-native";
import { SESSION_STORAGE_PREFIX } from "./authClient";
import type { SessionKeyStore } from "./signInActions";

export const BIOMETRIC_UNLOCK_KEY = `${SESSION_STORAGE_PREFIX}_biometric_unlock`;
export const BIOMETRIC_OFFERED_KEY = `${SESSION_STORAGE_PREFIX}_biometric_offered`;

export type BiometricKind = "faceId" | "touchId" | "biometrics";

export type BiometricSetting =
  { readonly available: false; readonly kind: BiometricKind } | { readonly available: true; readonly on: boolean; readonly kind: BiometricKind };

export type BiometricFailure = "cancelled" | "lockout" | "notSetUp" | "failed";

export type BiometricCheck = { readonly ok: true } | { readonly ok: false; readonly failure: BiometricFailure };

const failures: Partial<Record<LocalAuthentication.LocalAuthenticationError, BiometricFailure>> = {
  user_cancel: "cancelled",
  system_cancel: "cancelled",
  app_cancel: "cancelled",
  lockout: "lockout",
  not_enrolled: "notSetUp",
  passcode_not_set: "notSetUp",
  not_available: "notSetUp",
};

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

export async function checkBiometric(promptMessage: string): Promise<BiometricCheck> {
  try {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage, disableDeviceFallback: false });
    return result.success ? { ok: true } : { ok: false, failure: failures[result.error] ?? "failed" };
  } catch {
    return { ok: false, failure: "failed" };
  }
}

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

export async function clearBiometricUnlock(secureStore: SessionKeyStore, { resetOffer = false } = {}): Promise<void> {
  await secureStore.deleteItemAsync(BIOMETRIC_UNLOCK_KEY).catch(() => undefined);
  if (resetOffer) {
    await secureStore.deleteItemAsync(BIOMETRIC_OFFERED_KEY).catch(() => undefined);
  }
}
