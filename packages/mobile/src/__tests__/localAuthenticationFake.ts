import type { LocalAuthenticationError, LocalAuthenticationResult } from "expo-local-authentication";

/**
 * Stand-in for expo-local-authentication (the OS fingerprint / face / PIN prompt), mocked in nativeModuleMocks.ts.
 * Default: a phone with no biometrics, so tests that do not set it up never see the biometric steps.
 */
export const localAuthenticationFake = {
  hasHardware: false,
  enrolled: false,
  /** What the next OS prompts answer, in order; once empty, every prompt succeeds. */
  answers: [] as LocalAuthenticationError[],
  /** How many times the OS prompt was opened. */
  promptCount: 0,
};

/** A phone with a fingerprint enrolled; every OS prompt succeeds unless `answers` says otherwise. */
export function setUpEnrolledPhone(): void {
  Object.assign(localAuthenticationFake, { hasHardware: true, enrolled: true, answers: [], promptCount: 0 });
}

export function setUpPhoneWithoutBiometrics(): void {
  Object.assign(localAuthenticationFake, { hasHardware: false, enrolled: false, answers: [], promptCount: 0 });
}

export const localAuthenticationModule = {
  hasHardwareAsync: () => Promise.resolve(localAuthenticationFake.hasHardware),
  isEnrolledAsync: () => Promise.resolve(localAuthenticationFake.enrolled),
  authenticateAsync: (): Promise<LocalAuthenticationResult> => {
    localAuthenticationFake.promptCount += 1;
    const error = localAuthenticationFake.answers.shift();
    return Promise.resolve(error ? { success: false, error } : { success: true });
  },
};
