import { SIGN_UP_ATTESTATION_LABEL } from "@bjj-roll/shared";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMobileAuthClient, type MobileAuthClient } from "../auth/authClient";
import { BIOMETRIC_UNLOCK_KEY } from "../auth/biometricUnlock";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL, TEST_DELETE_CODE } from "./authTestDoubles";
import { localAuthenticationFake, setUpEnrolledPhone, setUpPhoneWithoutBiometrics } from "./localAuthenticationFake";
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

const SIGNED_IN_SCREEN = "You are signed in";
const SIGN_IN_SCREEN = "Sign in to BJJ Roll";
const OFFER_TITLE = "Unlock BJJ Roll with your fingerprint or face?";
const LOCKED_TITLE = "BJJ Roll is locked";
const TOGGLE_LABEL = "Biometric unlock";

describe("App opt-in biometric unlock (HEN-288)", () => {
  let backend: ReturnType<typeof createFakeBackend>;
  // One phone: the same SecureStore survives every launch in a test.
  let secureStore: ReturnType<typeof createMemorySecureStore>;
  /** Text of every screen rendered since the last launch. */
  let renderedScreens: string[] = [];

  /** A fresh app process on the same phone: new auth client, same SecureStore. */
  const launchApp = async () => {
    appClient.store = secureStore;
    appClient.current = createMobileAuthClient({
      backendUrl: TEST_BACKEND_URL,
      storage: secureStore,
      fetchImplementation: backend.fetchImplementation,
    });
    renderedScreens = [];
    return await renderScreen(createElement(App), (text) => renderedScreens.push(text));
  };
  type Screen = Awaited<ReturnType<typeof launchApp>>;
  const signIn = async (screen: Screen) => {
    await screen.pressRole("checkbox");
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    await screen.changeText("Email", "member@example.test");
    await screen.press("Continue with email");
    await screen.changeText("6-digit code", "123456");
  };
  /** First sign-in on this phone, answering the offer with `answer`. */
  const firstSignIn = async (answer: "Turn on" | "Not now") => {
    const screen = await launchApp();
    await signIn(screen);
    expect(screen.text()).toContain(OFFER_TITLE);
    await screen.press(answer);
    expect(screen.text()).toContain(SIGNED_IN_SCREEN);
    return screen;
  };
  const screensBefore = (text: string) =>
    renderedScreens.slice(
      0,
      renderedScreens.findIndex((rendered) => rendered.includes(text)),
    );

  beforeEach(() => {
    backend = createFakeBackend();
    secureStore = createMemorySecureStore();
    setUpEnrolledPhone();
  });

  it("offers biometric unlock once after the first sign-in: not after a restart, a sign-out or signing in again", async () => {
    const screen = await firstSignIn("Not now");

    expect((await launchApp()).text()).toContain(SIGNED_IN_SCREEN);
    await screen.press("Sign out");
    await signIn(screen);
    expect(screen.text()).toContain(SIGNED_IN_SCREEN);
    expect(screen.text()).not.toContain(OFFER_TITLE);
  });

  it("Not now: the app works as before, with no biometric check now or on the next launch", async () => {
    await firstSignIn("Not now");

    const nextLaunch = await launchApp();

    expect(nextLaunch.text()).toContain(SIGNED_IN_SCREEN);
    expect(localAuthenticationFake.promptCount).toBe(0);
  });

  it("Turn on: the next launch asks for the check before any signed-in screen shows", async () => {
    await firstSignIn("Turn on");
    localAuthenticationFake.answers.push("user_cancel");

    const nextLaunch = await launchApp();

    expect(nextLaunch.text()).toContain(LOCKED_TITLE);
    expect(renderedScreens.some((rendered) => rendered.includes(SIGNED_IN_SCREEN))).toBe(false);
    await nextLaunch.press("Unlock");
    expect(nextLaunch.text()).toContain(SIGNED_IN_SCREEN);
    expect(screensBefore(SIGNED_IN_SCREEN).every((rendered) => !rendered.includes("Export my data"))).toBe(true);
  });

  it("Turn on only sticks after a successful check; a failed one keeps the offer open", async () => {
    const screen = await launchApp();
    await signIn(screen);
    localAuthenticationFake.answers.push("authentication_failed");

    await screen.press("Turn on");
    expect(screen.text()).toContain(OFFER_TITLE);
    await screen.press("Not now");

    expect((await launchApp()).text()).toContain(SIGNED_IN_SCREEN);
  });

  it.each(["user_cancel", "authentication_failed", "lockout"] as const)(
    "a %s check at launch keeps the app locked; Unlock retries and Sign out stays available",
    async (failure) => {
      await firstSignIn("Turn on");
      localAuthenticationFake.answers.push(failure, failure);

      const nextLaunch = await launchApp();
      expect(nextLaunch.text()).toContain(LOCKED_TITLE);
      await nextLaunch.press("Unlock");
      expect(nextLaunch.text()).toContain(LOCKED_TITLE);
      expect(nextLaunch.text()).not.toContain(SIGNED_IN_SCREEN);

      await nextLaunch.press("Sign out");
      expect(nextLaunch.text()).toContain(SIGN_IN_SCREEN);
    },
  );

  it("unlocking at launch sends nothing to the server", async () => {
    await firstSignIn("Turn on");
    const nextLaunch = await launchApp();
    const requestsBeforeUnlock = backend.requests.length;
    expect(nextLaunch.text()).toContain(SIGNED_IN_SCREEN);

    const unlockRequests = backend.requests.slice(requestsBeforeUnlock).map((request) => new URL(request.url).pathname);
    expect(unlockRequests.filter((path) => path !== "/account/age-confirmation")).toEqual([]);
  });

  it("keeps only on/off flags on the phone, never biometric data", async () => {
    const keysBefore = new Set(secureStore.items.keys());
    await firstSignIn("Turn on");

    const added = [...secureStore.items].filter(([key]) => !keysBefore.has(key) && !key.endsWith("_cookie") && !key.endsWith("_session_data"));
    expect(Object.fromEntries(added)).toEqual({ bjjroll_biometric_offered: "1", bjjroll_biometric_unlock: "on" });
  });

  describe("phone without biometrics enrolled", () => {
    beforeEach(() => setUpPhoneWithoutBiometrics());

    it("does not offer biometric unlock after sign-in", async () => {
      const screen = await launchApp();
      await signIn(screen);

      expect(screen.text()).toContain(SIGNED_IN_SCREEN);
      expect(screen.text()).not.toContain(OFFER_TITLE);
    });

    it("shows the settings toggle disabled with a short note", async () => {
      const screen = await launchApp();
      await signIn(screen);

      expect(screen.getByLabelText(TOGGLE_LABEL).props.disabled).toBe(true);
      expect(screen.text()).toContain("Add a fingerprint or face in your phone's Settings to use this.");
    });
  });

  describe("settings toggle", () => {
    // The whole row is the switch (Vera round 2, fix 4): a tap flips it.
    const toggleValue = (screen: Screen) => (screen.getByRole("switch").props.accessibilityState as { checked: boolean }).checked;
    const toggle = async (screen: Screen, value: boolean) => {
      expect(toggleValue(screen)).toBe(!value);
      await screen.press(TOGGLE_LABEL);
    };

    it("on and off both survive a restart", async () => {
      const screen = await firstSignIn("Not now");
      await toggle(screen, true);
      expect(toggleValue(screen)).toBe(true);

      const lockedLaunch = await launchApp();
      expect(lockedLaunch.text()).toContain(SIGNED_IN_SCREEN);
      expect(toggleValue(lockedLaunch)).toBe(true);
      await toggle(lockedLaunch, false);

      const unlockedLaunch = await launchApp();
      expect(unlockedLaunch.text()).toContain(SIGNED_IN_SCREEN);
      expect(toggleValue(unlockedLaunch)).toBe(false);
    });

    it("turning on needs a successful check first; a failed check leaves it off", async () => {
      const screen = await firstSignIn("Not now");
      localAuthenticationFake.answers.push("user_cancel");

      await toggle(screen, true);

      expect(toggleValue(screen)).toBe(false);
      expect(localAuthenticationFake.promptCount).toBe(1);
      expect((await launchApp()).text()).not.toContain(LOCKED_TITLE);
    });

    it("turning off needs no check", async () => {
      const screen = await firstSignIn("Turn on");
      const promptsBefore = localAuthenticationFake.promptCount;

      await toggle(screen, false);

      expect(toggleValue(screen)).toBe(false);
      expect(localAuthenticationFake.promptCount).toBe(promptsBefore);
    });
  });

  describe("signing out and deleting the account clear the setting", () => {
    it("sign-out: signing in again does not lock the next launch", async () => {
      const screen = await firstSignIn("Turn on");
      await screen.press("Sign out");
      await signIn(screen);

      const nextLaunch = await launchApp();

      expect(nextLaunch.text()).toContain(SIGNED_IN_SCREEN);
      // The fake prompt passes by default, so a lock screen that unlocked itself would still end signed in (Bill, round 3).
      expect(renderedScreens.some((rendered) => rendered.includes(LOCKED_TITLE))).toBe(false);
      expect(await secureStore.getItemAsync(BIOMETRIC_UNLOCK_KEY)).toBeNull();
    });

    it("account delete: a new account on this phone does not lock the next launch", async () => {
      const screen = await firstSignIn("Turn on");
      await screen.press("Delete account");
      await screen.press("Email me a code");
      await screen.changeText("6-digit code", TEST_DELETE_CODE);
      await screen.press("Delete my account");
      expect(screen.text()).toContain(SIGN_IN_SCREEN);
      await signIn(screen);

      const nextLaunch = await launchApp();

      expect(nextLaunch.text()).toContain(SIGNED_IN_SCREEN);
      // The fake prompt passes by default, so a lock screen that unlocked itself would still end signed in (Bill, round 3).
      expect(renderedScreens.some((rendered) => rendered.includes(LOCKED_TITLE))).toBe(false);
      expect(await secureStore.getItemAsync(BIOMETRIC_UNLOCK_KEY)).toBeNull();
    });
  });
});
