import type { LocalAuthenticationError, LocalAuthenticationResult } from "expo-local-authentication";

export const authenticationType = { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 } as const;

export const localAuthenticationFake = {
  hasHardware: false,
  enrolled: false,
  supportedTypes: [] as number[],
  answers: [] as LocalAuthenticationError[],
  promptCount: 0,
};

export function setUpEnrolledPhone(supportedTypes: number[] = [authenticationType.FINGERPRINT, authenticationType.FACIAL_RECOGNITION]): void {
  Object.assign(localAuthenticationFake, { hasHardware: true, enrolled: true, supportedTypes, answers: [], promptCount: 0 });
}

export function setUpPhoneWithoutBiometrics(supportedTypes: number[] = []): void {
  Object.assign(localAuthenticationFake, { hasHardware: supportedTypes.length > 0, enrolled: false, supportedTypes, answers: [], promptCount: 0 });
}

export const localAuthenticationModule = {
  AuthenticationType: authenticationType,
  supportedAuthenticationTypesAsync: () => Promise.resolve(localAuthenticationFake.supportedTypes),
  hasHardwareAsync: () => Promise.resolve(localAuthenticationFake.hasHardware),
  isEnrolledAsync: () => Promise.resolve(localAuthenticationFake.enrolled),
  authenticateAsync: (): Promise<LocalAuthenticationResult> => {
    localAuthenticationFake.promptCount += 1;
    const error = localAuthenticationFake.answers.shift();
    return Promise.resolve(error ? { success: false, error } : { success: true });
  },
};
