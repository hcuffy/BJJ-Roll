import { SIGN_UP_ATTESTATION_LABEL } from "@bjj-roll/shared";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMobileAuthClient, type MobileAuthClient } from "../auth/authClient";
import { BIOMETRIC_UNLOCK_KEY } from "../auth/biometricUnlock";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL, TEST_DELETE_CODE } from "./authTestDoubles";
import { resetBackListeners } from "./backHandlerHarness";
import { localAuthenticationFake, setUpEnrolledPhone } from "./localAuthenticationFake";
import { deepLinkState, renderScreen, settle } from "./screenHarness";

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
const LOCKED_TITLE = "BJJ Roll is locked";
const GATE_TITLE = "Accept the sign-up duties";
const EMAIL_SCREEN = "Continue with email";

describe("App: sign-out and delete clear biometric unlock (HEN-288 x HEN-314, HEN-308)", () => {
  let backend: ReturnType<typeof createFakeBackend>;
  let secureStore: ReturnType<typeof createMemorySecureStore>;
  let signOutHangs: boolean;
  let signOutFails: boolean;
  let unanswered: (() => void)[];
  let renderedScreens: string[] = [];

  const launchApp = async () => {
    appClient.store = secureStore;
    appClient.current = createMobileAuthClient({
      backendUrl: TEST_BACKEND_URL,
      storage: secureStore,
      fetchImplementation: vi.fn((input: string | URL | Request, init?: RequestInit) => {
        if (!signOutHangs || !new Request(input, init).url.endsWith("/sign-out")) {
          return backend.fetchImplementation(input, init);
        }
        const answer = () => (signOutFails ? Promise.resolve(new Response("{}", { status: 500 })) : backend.fetchImplementation(input, init));
        return new Promise<Response>((resolve) => unanswered.push(() => void answer().then(resolve)));
      }),
    });
    renderedScreens = [];
    return await renderScreen(createElement(App), (text) => renderedScreens.push(text));
  };
  const signInWithBiometricOn = async (expectedTitle: string) => {
    const screen = await launchApp();
    await screen.pressRole("checkbox");
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    await screen.changeText("Email", "member@example.test");
    await screen.press("Continue with email");
    await screen.changeText("6-digit code", "123456");
    await screen.press("Turn on");
    expect(screen.text()).toContain(expectedTitle);
    expect(await secureStore.getItemAsync(BIOMETRIC_UNLOCK_KEY)).toBe("on");
    return screen;
  };
  const relaunchLocked = async () => {
    localAuthenticationFake.answers.push("user_cancel");
    const locked = await launchApp();
    expect(locked.text()).toContain(LOCKED_TITLE);
    return locked;
  };
  const flag = () => secureStore.getItemAsync(BIOMETRIC_UNLOCK_KEY);

  beforeEach(() => {
    backend = createFakeBackend();
    secureStore = createMemorySecureStore();
    signOutHangs = false;
    signOutFails = false;
    unanswered = [];
    deepLinkState.url = null;
    resetBackListeners();
    setUpEnrolledPhone();
  });
  afterEach(() => {
    for (const answer of unanswered) {
      answer();
    }
  });

  it("a delete from the gate clears the biometric flag: after the lock and the gate, the next launch has no lock", async () => {
    backend = createFakeBackend({ signUpAttestationAcceptedVersion: null });
    await signInWithBiometricOn(GATE_TITLE);
    const locked = await relaunchLocked();
    await locked.press("Unlock");
    expect(locked.text()).toContain(GATE_TITLE);

    await locked.press("Delete account");
    await locked.press("Email me a code");
    await locked.changeText("6-digit code", TEST_DELETE_CODE);
    await locked.press("Delete my account");
    expect(locked.text()).toContain("Your account was deleted.");
    expect(await flag()).toBeNull();

    const nextLaunch = await launchApp();
    expect(renderedScreens.some((text) => text.includes(LOCKED_TITLE))).toBe(false);
    expect(nextLaunch.text()).toContain(EMAIL_SCREEN);
  });

  it("sign-out tap clears the biometric flag even when the server/timeout never answers", async () => {
    const screen = await signInWithBiometricOn(SIGNED_IN_SCREEN);
    signOutHangs = true;

    await screen.press("Sign out");
    await settle();
    expect(unanswered.length).toBeGreaterThan(0);
    expect(await flag()).toBeNull();
  });

  it.each([
    ["succeeds", false],
    ["fails", true],
  ])("HEN-331: no biometric toggle can be changed while sign-out runs, and the sign-in screen follows when it %s", async (_outcome, fails) => {
    const screen = await signInWithBiometricOn(SIGNED_IN_SCREEN);
    signOutHangs = true;
    signOutFails = fails;
    const rendersBefore = renderedScreens.length;
    expect(screen.findAllByType("Switch")).toHaveLength(1);

    await screen.press("Sign out");
    await settle();
    expect(unanswered.length).toBeGreaterThan(0);
    expect(screen.findAllByType("Switch")).toEqual([]);

    for (const answer of unanswered.splice(0)) {
      answer();
    }
    await settle();
    await screen.rerender();
    expect(screen.text()).toContain(EMAIL_SCREEN);
    expect(renderedScreens.slice(rendersBefore).some((text) => text.includes(SIGNED_IN_SCREEN))).toBe(false);
  });

  it("lock screen sign-out uses the same handler: flag cleared at the tap, server sign-out sent, sign-in screen, no lock next launch", async () => {
    await signInWithBiometricOn(SIGNED_IN_SCREEN);
    const locked = await relaunchLocked();
    signOutHangs = true;

    await locked.press("Sign out");
    await settle();
    expect(unanswered.length).toBeGreaterThan(0);
    expect(await flag()).toBeNull();

    for (const answer of unanswered.splice(0)) {
      answer();
    }
    await settle();
    await locked.rerender();
    expect(locked.text()).toContain(EMAIL_SCREEN);

    const promptsBefore = localAuthenticationFake.promptCount;
    const nextLaunch = await launchApp();
    expect(nextLaunch.text()).toContain(EMAIL_SCREEN);
    expect(renderedScreens.some((text) => text.includes(LOCKED_TITLE) || text.includes(SIGNED_IN_SCREEN))).toBe(false);
    expect(localAuthenticationFake.promptCount).toBe(promptsBefore);
  });
});
