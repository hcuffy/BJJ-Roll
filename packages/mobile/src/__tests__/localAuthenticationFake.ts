import type { LocalAuthenticationError, LocalAuthenticationResult } from "expo-local-authentication";

/**
 * Stand-in for expo-local-authentication (the OS fingerprint / face / PIN prompt), mocked in nativeModuleMocks.ts.
 * Default: a phone with no biometrics, so tests that do not set it up never see the biometric steps.
 */
/** Same values as the library's AuthenticationType enum. */
export const AuthenticationType = { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 } as const;

export const localAuthenticationFake = {
  hasHardware: false,
  enrolled: false,
  /** What supportedAuthenticationTypesAsync reports: the sensors the phone has, enrolled or not. */
  supportedTypes: [] as number[],
  /** What the next OS prompts answer, in order; once empty, every prompt succeeds. */
  answers: [] as LocalAuthenticationError[],
  /** How many times the OS prompt was opened. */
  promptCount: 0,
};

/** A phone with biometrics enrolled (fingerprint and face by default); every OS prompt succeeds unless `answers` says otherwise. */
export function setUpEnrolledPhone(supportedTypes: number[] = [AuthenticationType.FINGERPRINT, AuthenticationType.FACIAL_RECOGNITION]): void {
  Object.assign(localAuthenticationFake, { hasHardware: true, enrolled: true, supportedTypes, answers: [], promptCount: 0 });
}

/** A phone with no biometrics enrolled; `supportedTypes` lists sensors it has but nobody set up. */
export function setUpPhoneWithoutBiometrics(supportedTypes: number[] = []): void {
  Object.assign(localAuthenticationFake, { hasHardware: supportedTypes.length > 0, enrolled: false, supportedTypes, answers: [], promptCount: 0 });
}

export const localAuthenticationModule = {
  AuthenticationType,
  supportedAuthenticationTypesAsync: () => Promise.resolve(localAuthenticationFake.supportedTypes),
  hasHardwareAsync: () => Promise.resolve(localAuthenticationFake.hasHardware),
  isEnrolledAsync: () => Promise.resolve(localAuthenticationFake.enrolled),
  authenticateAsync: (): Promise<LocalAuthenticationResult> => {
    localAuthenticationFake.promptCount += 1;
    const error = localAuthenticationFake.answers.shift();
    return Promise.resolve(error ? { success: false, error } : { success: true });
  },
};
