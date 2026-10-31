import { SIGN_UP_ATTESTATION_LABEL } from "@bjj-roll/shared";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMobileAuthClient, type MobileAuthClient } from "../auth/authClient";
import { BIOMETRIC_UNLOCK_KEY } from "../auth/biometricUnlock";
import { failureMessages } from "../auth/signInActions";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL } from "./authTestDoubles";
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
const REJECTED_LINK = "bjjroll://auth?r=link_invalid";
const EXPIRED_MESSAGE = failureMessages.invalidLink;

describe("a failed magic link never shows the biometric lock (HEN-288 x HEN-304, Bill gate @ f353356)", () => {
  let backend: ReturnType<typeof createFakeBackend>;
  let secureStore: ReturnType<typeof createMemorySecureStore>;
  let exchangeHangs: boolean;
  let renderedScreens: string[] = [];
  const everRendered = (text: string) => renderedScreens.some((rendered) => rendered.includes(text));
  const exchanges = () => backend.requests.filter((request) => new URL(request.url).pathname.endsWith("/magic-link/exchange")).length;

  const launchApp = async () => {
    appClient.store = secureStore;
    appClient.current = createMobileAuthClient({
      backendUrl: TEST_BACKEND_URL,
      storage: secureStore,
      fetchImplementation: vi.fn((input: string | URL | Request, init?: RequestInit) =>
        exchangeHangs && new Request(input, init).url.endsWith("/magic-link/exchange")
          ? new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
            })
          : backend.fetchImplementation(input, init),
      ),
    });
    renderedScreens = [];
    return await renderScreen(createElement(App), (text) => renderedScreens.push(text));
  };
  const signInWithBiometricOn = async () => {
    const screen = await launchApp();
    await screen.pressRole("checkbox");
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    await screen.changeText("Email", "member@example.test");
    await screen.press("Continue with email");
    await screen.changeText("6-digit code", "123456");
    await screen.press("Turn on");
    expect(screen.text()).toContain(SIGNED_IN_SCREEN);
    expect(await secureStore.getItemAsync(BIOMETRIC_UNLOCK_KEY)).toBe("on");
    return screen;
  };

  beforeEach(() => {
    backend = createFakeBackend();
    secureStore = createMemorySecureStore();
    exchangeHangs = false;
    deepLinkState.url = null;
    setUpEnrolledPhone();
  });
  afterEach(() => {
    deepLinkState.url = null;
    vi.useRealTimers();
  });

  it("a rejected link in the running, unlocked app with biometric unlock on never locks it", async () => {
    const screen = await signInWithBiometricOn();
    const promptsBefore = localAuthenticationFake.promptCount;
    const exchangesBefore = exchanges();

    deepLinkState.url = REJECTED_LINK;
    await screen.rerender();
    await screen.rerender();
    expect(exchanges()).toBe(exchangesBefore);
    expect(screen.text()).toContain(SIGNED_IN_SCREEN);
    expect(everRendered(LOCKED_TITLE)).toBe(false);
    expect(localAuthenticationFake.promptCount).toBe(promptsBefore);
  });

  it("signed out with the biometric flag left on: a rejected link at cold start shows the link card, never the lock", async () => {
    await secureStore.setItemAsync(BIOMETRIC_UNLOCK_KEY, "on");
    deepLinkState.url = REJECTED_LINK;
    const screen = await launchApp();
    expect(everRendered(LOCKED_TITLE)).toBe(false);
    expect(everRendered(SIGNED_IN_SCREEN)).toBe(false);
    expect(screen.text()).toContain(EXPIRED_MESSAGE);
    expect(localAuthenticationFake.promptCount).toBe(0);
  });
});
