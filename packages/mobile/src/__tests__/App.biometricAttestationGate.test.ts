import { SIGN_UP_ATTESTATION_LABEL } from "@bjj-roll/shared";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMobileAuthClient, type MobileAuthClient } from "../auth/authClient";
import { BIOMETRIC_UNLOCK_KEY } from "../auth/biometricUnlock";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL, TEST_DELETE_CODE } from "./authTestDoubles";
import { resetBackListeners } from "./backHandlerHarness";
import { localAuthenticationFake, setUpEnrolledPhone } from "./localAuthenticationFake";
import { deepLinkState, renderScreen } from "./screenHarness";

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

const GATE_TITLE = "Accept the sign-up duties";
const LOCKED_TITLE = "BJJ Roll is locked";

describe("App: biometric unlock with the sign-up attestation gate (HEN-288 x HEN-183)", () => {
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

  /** Signs in, turns biometric unlock on at the offer, and lands on the gate (this account has no attestation record). */
  const signInTurnOnToGate = async () => {
    const screen = await launchApp();
    await screen.pressRole("checkbox");
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    await screen.changeText("Email", "member@example.test");
    await screen.press("Continue with email");
    await screen.changeText("6-digit code", "123456");
    await screen.press("Turn on");
    expect(screen.text()).toContain(GATE_TITLE);
    expect(await secureStore.getItemAsync(BIOMETRIC_UNLOCK_KEY)).toBe("on");
    return screen;
  };

  beforeEach(() => {
    backend = createFakeBackend({ signUpAttestationAcceptedVersion: null });
    secureStore = createMemorySecureStore();
    deepLinkState.url = null;
    resetBackListeners();
    setUpEnrolledPhone();
  });

  it("relaunch shows the lock before the gate (no gate or Delete account frame first), and Unlock then shows the gate", async () => {
    await signInTurnOnToGate();

    localAuthenticationFake.answers.push("user_cancel");
    const relaunched = await launchApp();
    expect(relaunched.text()).toContain(LOCKED_TITLE);
    expect(renderedScreens.some((text) => text.includes(GATE_TITLE) || text.includes("Delete account"))).toBe(false);

    await relaunched.press("Unlock");
    expect(relaunched.text()).toContain(GATE_TITLE);
  });

  it("deleting the account from the gate turns biometric unlock off", async () => {
    const screen = await signInTurnOnToGate();

    await screen.press("Delete account");
    await screen.press("Email me a code");
    await screen.changeText("6-digit code", TEST_DELETE_CODE);
    await screen.press("Delete my account");
    expect(screen.text()).toContain("Your account was deleted.");
    expect(await secureStore.getItemAsync(BIOMETRIC_UNLOCK_KEY)).toBeNull();
  });
});
