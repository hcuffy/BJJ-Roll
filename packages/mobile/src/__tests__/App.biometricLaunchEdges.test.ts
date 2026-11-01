import { SIGN_UP_ATTESTATION_LABEL } from "@bjj-roll/shared";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMobileAuthClient, type MobileAuthClient } from "../auth/authClient";
import { BIOMETRIC_UNLOCK_KEY } from "../auth/biometricUnlock";
import { emitAppState } from "./appStateHarness";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL, seedPendingSignIn } from "./authTestDoubles";
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

const SIGNED_IN_SCREEN = "You are signed in";
const LOCKED_TITLE = "BJJ Roll is locked";

describe("App biometric unlock at launch: read errors and magic links (HEN-288, Bill round 3)", () => {
  let backend: ReturnType<typeof createFakeBackend>;
  let secureStore: ReturnType<typeof createMemorySecureStore>;
  let renderedScreens: string[] = [];
  const everRendered = (text: string) => renderedScreens.some((rendered) => rendered.includes(text));

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
  const firstSignIn = async (answer: "Turn on" | "Not now") => {
    const screen = await launchApp();
    await screen.pressRole("checkbox");
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    await screen.changeText("Email", "member@example.test");
    await screen.press("Continue with email");
    await screen.changeText("6-digit code", "123456");
    await screen.press(answer);
    expect(screen.text()).toContain(SIGNED_IN_SCREEN);
  };

  beforeEach(() => {
    backend = createFakeBackend();
    secureStore = createMemorySecureStore();
    seedPendingSignIn(secureStore);
    setUpEnrolledPhone();
  });
  afterEach(() => {
    deepLinkState.url = null;
  });

  it("fails closed: if the setting cannot be read at launch, a signed-in session gets the lock screen", async () => {
    await firstSignIn("Not now");
    const readSetting = secureStore.getItemAsync;
    secureStore.getItemAsync = (key: string) =>
      key === BIOMETRIC_UNLOCK_KEY ? Promise.reject(new Error("SecureStore read failed")) : readSetting(key);
    localAuthenticationFake.answers.push("user_cancel");

    const nextLaunch = await launchApp();

    expect(nextLaunch.text()).toContain(LOCKED_TITLE);
    expect(everRendered(SIGNED_IN_SCREEN)).toBe(false);
    expect(localAuthenticationFake.promptCount).toBe(1);
  });

  it("locks only at app start: coming back from the background does not lock again", async () => {
    await firstSignIn("Turn on");
    const nextLaunch = await launchApp();
    expect(everRendered(LOCKED_TITLE)).toBe(true);
    expect(nextLaunch.text()).toContain(SIGNED_IN_SCREEN);
    const promptsBefore = localAuthenticationFake.promptCount;

    emitAppState("background");
    emitAppState("active");
    await nextLaunch.rerender();
    expect(nextLaunch.text()).toContain(SIGNED_IN_SCREEN);
    expect(nextLaunch.text()).not.toContain(LOCKED_TITLE);
    expect(localAuthenticationFake.promptCount).toBe(promptsBefore);
  });

  it("magic link while locked: signs in AND lock screen still shows when biometric on", async () => {
    await firstSignIn("Turn on");

    seedPendingSignIn(secureStore);
    deepLinkState.url = "bjjroll://auth?code=one-time-exchange-code";
    localAuthenticationFake.answers.push("user_cancel");
    const linkLaunch = await launchApp();
    expect(backend.requests.some((request) => new URL(request.url).pathname.endsWith("/magic-link/exchange"))).toBe(true);
    expect(linkLaunch.text()).toContain(LOCKED_TITLE);
    expect(everRendered(SIGNED_IN_SCREEN)).toBe(false);
    expect(await secureStore.getItemAsync(BIOMETRIC_UNLOCK_KEY)).toBe("on");

    await linkLaunch.press("Unlock");
    expect(linkLaunch.text()).toContain(SIGNED_IN_SCREEN);
  });

  it("magic link with the setting off goes straight in, with no lock", async () => {
    await firstSignIn("Not now");
    const promptsBefore = localAuthenticationFake.promptCount;

    deepLinkState.url = "bjjroll://auth?code=one-time-exchange-code";
    const linkLaunch = await launchApp();
    expect(linkLaunch.text()).toContain(SIGNED_IN_SCREEN);
    expect(everRendered(LOCKED_TITLE)).toBe(false);
    expect(localAuthenticationFake.promptCount).toBe(promptsBefore);
  });
});
