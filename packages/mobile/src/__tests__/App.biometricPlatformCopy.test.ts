import { SIGN_UP_ATTESTATION_LABEL } from "@bjj-roll/shared";
import { createElement } from "react";
import { Platform } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMobileAuthClient, type MobileAuthClient } from "../auth/authClient";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL } from "./authTestDoubles";
import { AuthenticationType, localAuthenticationFake, setUpEnrolledPhone, setUpPhoneWithoutBiometrics } from "./localAuthenticationFake";
import { renderScreen } from "./screenHarness";

const appClient = vi.hoisted(() => ({ current: null as MobileAuthClient | null, store: null as ReturnType<typeof createMemorySecureStore> | null }));
vi.mock("../auth/appAuthClient", () => ({
  get appAuthClient() {
    return appClient.current;
  },
  get appSecureStore() {
    return appClient.store;
  },
  appBackendUrl: "http://backend.test",
}));

const { App } = await import("../App");

interface PlatformCase {
  readonly name: string;
  readonly os: "ios" | "android";
  readonly sensors: number[];
  readonly offerTitle: string;
  readonly lockLine: string;
  readonly toggleLabel: string;
  readonly setUpNote: string;
  readonly lockoutError: string;
  readonly notSetUpError: string;
}

const platformCases: PlatformCase[] = [
  {
    name: "iOS Face ID",
    os: "ios",
    sensors: [AuthenticationType.FACIAL_RECOGNITION],
    offerTitle: "Unlock BJJ Roll with Face ID?",
    lockLine: "Use Face ID or your passcode to unlock.",
    toggleLabel: "Face ID",
    setUpNote: "Set up Face ID in Settings to use this.",
    lockoutError: "Too many tries. Use your passcode, or try again in a moment.",
    notSetUpError: "Face ID isn't set up on this phone. Sign out, then sign in with your email.",
  },
  {
    name: "iOS Touch ID",
    os: "ios",
    sensors: [AuthenticationType.FINGERPRINT],
    offerTitle: "Unlock BJJ Roll with Touch ID?",
    lockLine: "Use Touch ID or your passcode to unlock.",
    toggleLabel: "Touch ID",
    setUpNote: "Set up Touch ID in Settings to use this.",
    lockoutError: "Too many tries. Use your passcode, or try again in a moment.",
    notSetUpError: "Touch ID isn't set up on this phone. Sign out, then sign in with your email.",
  },
  {
    name: "Android",
    os: "android",
    sensors: [AuthenticationType.FINGERPRINT, AuthenticationType.FACIAL_RECOGNITION],
    offerTitle: "Unlock BJJ Roll with your fingerprint or face?",
    lockLine: "Use your fingerprint, face or screen lock to unlock.",
    toggleLabel: "Biometric unlock",
    setUpNote: "Add a fingerprint or face in your phone's Settings to use this.",
    lockoutError: "Too many tries. Use your screen lock, or try again in a moment.",
    notSetUpError: "No fingerprint, face or screen lock is set up on this phone. Sign out, then sign in with your email.",
  },
];

describe.each(platformCases)("biometric unlock wording on $name (Vera round 2, fixes 2 and 3)", (platform) => {
  let backend: ReturnType<typeof createFakeBackend>;
  let secureStore: ReturnType<typeof createMemorySecureStore>;

  const launchApp = async () => {
    appClient.store = secureStore;
    appClient.current = createMobileAuthClient({
      backendUrl: TEST_BACKEND_URL,
      storage: secureStore,
      fetchImplementation: backend.fetchImplementation,
    });
    return await renderScreen(createElement(App));
  };
  const signIn = async (screen: Awaited<ReturnType<typeof launchApp>>) => {
    await screen.pressRole("checkbox");
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    await screen.changeText("Email", "member@example.test");
    await screen.press("Continue with email");
    await screen.changeText("6-digit code", "123456");
  };
  const signInAndTurnOn = async () => {
    const screen = await launchApp();
    await signIn(screen);
    await screen.press("Turn on");
  };

  beforeEach(() => {
    Platform.OS = platform.os;
    backend = createFakeBackend();
    secureStore = createMemorySecureStore();
    setUpEnrolledPhone(platform.sensors);
  });
  afterEach(() => {
    Platform.OS = "android";
  });

  it("uses the platform's own words on the offer, the lock screen and the toggle", async () => {
    const screen = await launchApp();
    await signIn(screen);
    expect(screen.text()).toContain(platform.offerTitle);
    await screen.press("Turn on");

    expect(screen.queryByText(platform.toggleLabel)).not.toBeNull();
    expect(screen.getByRole("switch").props.accessibilityLabel).toBe(platform.toggleLabel);
    localAuthenticationFake.answers.push("user_cancel");
    expect((await launchApp()).text()).toContain(platform.lockLine);
  });

  it("explains how to set it up when the phone has the sensor but nothing enrolled", async () => {
    setUpPhoneWithoutBiometrics(platform.sensors);
    const screen = await launchApp();
    await signIn(screen);

    expect(screen.text()).toContain(platform.setUpNote);
  });

  it("names a lockout and a missing set-up at the lock screen, and says signing out keeps the account", async () => {
    await signInAndTurnOn();
    localAuthenticationFake.answers.push("lockout", "not_enrolled", "passcode_not_set");

    const nextLaunch = await launchApp();
    expect(nextLaunch.text()).toContain(platform.lockoutError);
    await nextLaunch.press("Unlock");
    expect(nextLaunch.text()).toContain(platform.notSetUpError);
    expect(nextLaunch.text()).not.toContain(platform.lockoutError);
    await nextLaunch.press("Unlock");
    expect(nextLaunch.text()).toContain(platform.notSetUpError);

    expect(nextLaunch.text()).toContain("Signing out keeps your account. You can sign back in with your email.");
  });
});
