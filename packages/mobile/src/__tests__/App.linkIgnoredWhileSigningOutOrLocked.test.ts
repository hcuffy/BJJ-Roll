import { SIGN_UP_ATTESTATION_LABEL } from "@bjj-roll/shared";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMobileAuthClient, type MobileAuthClient } from "../auth/authClient";
import { createFakeBackend, createMemorySecureStore, PENDING_SIGN_IN_KEY, TEST_BACKEND_URL, seedPendingSignIn } from "./authTestDoubles";
import { localAuthenticationFake, setUpEnrolledPhone, setUpPhoneWithoutBiometrics } from "./localAuthenticationFake";
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
const SIGN_IN_SCREEN = "Sign in to BJJ Roll";
const LOCKED_TITLE = "BJJ Roll is locked";
const GOOD_LINK = "bjjroll://auth?code=one-time-exchange-code";
const PENDING_SIGN_OUT_KEY = "bjjroll_pending_sign_out";

describe("App: a sign-in link is ignored while signing out or locked (Bill gate nit 3)", () => {
  let backend: ReturnType<typeof createFakeBackend>;
  let secureStore: ReturnType<typeof createMemorySecureStore>;
  const exchanges = () => backend.requests.filter((request) => new URL(request.url).pathname.endsWith("/magic-link/exchange")).length;

  const launchApp = async () => {
    appClient.store = secureStore;
    appClient.current = createMobileAuthClient({
      backendUrl: TEST_BACKEND_URL,
      storage: secureStore,
      fetchImplementation: backend.fetchImplementation,
    });
    const screen = await renderScreen(createElement(App));
    await settle();
    return screen;
  };
  const signInWithCode = async (screen: Awaited<ReturnType<typeof launchApp>>) => {
    await screen.pressRole("checkbox");
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    await screen.changeText("Email", "member@example.test");
    await screen.press("Continue with email");
    await screen.changeText("6-digit code", "123456");
  };

  beforeEach(() => {
    backend = createFakeBackend();
    secureStore = createMemorySecureStore();
    deepLinkState.url = null;
  });
  afterEach(() => {
    deepLinkState.url = null;
  });

  it("a link that arrives while the sign-out is still running is not exchanged and the app ends signed out", async () => {
    setUpPhoneWithoutBiometrics();
    const screen = await launchApp();
    await signInWithCode(screen);
    expect(screen.text()).toContain(SIGNED_IN_SCREEN);

    let finishSignOutWrite = () => undefined as void;
    const writeQueue = secureStore.setItemAsync;
    secureStore.setItemAsync = (key, value) =>
      key === PENDING_SIGN_OUT_KEY
        ? new Promise<void>((resolve) => {
            finishSignOutWrite = () => resolve(writeQueue(key, value));
          })
        : writeQueue(key, value);
    await screen.press("Sign out");
    expect(screen.text()).toContain("Loading");

    seedPendingSignIn(secureStore);
    deepLinkState.url = GOOD_LINK;
    await screen.rerender();
    await settle();
    expect(exchanges()).toBe(0);

    secureStore.setItemAsync = writeQueue;
    finishSignOutWrite();
    await settle();
    await screen.rerender();
    expect(screen.text()).toContain(SIGN_IN_SCREEN);
    expect(screen.text()).not.toContain(SIGNED_IN_SCREEN);
    expect(exchanges()).toBe(0);
  });

  it("a link that arrives on the lock screen is not exchanged and the phone stays locked with its pending sign-in unspent", async () => {
    setUpEnrolledPhone();
    const first = await launchApp();
    await signInWithCode(first);
    await first.press("Turn on");
    expect(first.text()).toContain(SIGNED_IN_SCREEN);

    localAuthenticationFake.answers.push("user_cancel");
    const locked = await launchApp();
    expect(locked.text()).toContain(LOCKED_TITLE);

    seedPendingSignIn(secureStore);
    const pendingBefore = secureStore.items.get(PENDING_SIGN_IN_KEY);
    deepLinkState.url = GOOD_LINK;
    await locked.rerender();
    await settle();
    expect(exchanges()).toBe(0);
    expect(locked.text()).toContain(LOCKED_TITLE);
    expect(locked.text()).not.toContain(SIGNED_IN_SCREEN);
    expect(secureStore.items.get(PENDING_SIGN_IN_KEY)).toBe(pendingBefore);
  });
});
