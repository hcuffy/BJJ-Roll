import { SIGN_UP_ATTESTATION_LABEL } from "@bjj-roll/shared";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMobileAuthClient, type MobileAuthClient } from "../auth/authClient";
import { BIOMETRIC_UNLOCK_KEY } from "../auth/biometricUnlock";
import { FAILURE_MESSAGES } from "../auth/signInActions";
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
const { STARTUP_REQUEST_TIMEOUT_MS } = await import("../auth/startupTimeout");

const SIGNED_IN_SCREEN = "You are signed in";
const LOCKED_TITLE = "BJJ Roll is locked";
const GOOD_LINK = "bjjroll://auth?code=one-time-exchange-code";
const REJECTED_LINK = "bjjroll://auth?r=link_invalid";
const EXPIRED_MESSAGE = FAILURE_MESSAGES.invalidLink;

/**
 * HEN-288 merged with main 66c8eb1 (#83 timeouts, #84 link results): the lock decision lives in the link's success branch,
 * after the timed exchange. A failed or timed-out link changes nothing for a locked app, and a timeout never locks.
 */
describe("App: magic links and the biometric lock after the #83/#84 merge (HEN-288, HEN-303, HEN-304)", () => {
  let backend: ReturnType<typeof createFakeBackend>;
  // One phone: the same SecureStore survives every launch in a test.
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
  /** Signs in by code with biometric unlock turned on at the offer, as a member did before this launch. */
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

  it("failed link while locked stays locked: a rejected link at launch and a timed-out link on the lock change nothing", async () => {
    await signInWithBiometricOn();

    // Cold start from a rejected link: the startup lock shows, never the signed-in screen or the link card.
    deepLinkState.url = REJECTED_LINK;
    localAuthenticationFake.answers.push("user_cancel");
    const locked = await launchApp();
    expect(locked.text()).toContain(LOCKED_TITLE);
    expect(locked.text()).not.toContain(EXPIRED_MESSAGE);
    expect(everRendered(SIGNED_IN_SCREEN)).toBe(false);

    // While still locked, a second link never answers and times out: the app stays on the lock.
    vi.useFakeTimers();
    exchangeHangs = true;
    deepLinkState.url = `${GOOD_LINK}&n=2`;
    await locked.rerender();
    await vi.advanceTimersByTimeAsync(STARTUP_REQUEST_TIMEOUT_MS);
    await locked.rerender();
    expect(locked.text()).toContain(LOCKED_TITLE);
    expect(everRendered(SIGNED_IN_SCREEN)).toBe(false);
    expect(await secureStore.getItemAsync(BIOMETRIC_UNLOCK_KEY)).toBe("on");
  });

  it("cold-start link success with biometric on shows the lock: the exchange runs, then the lock, never the signed-in screen", async () => {
    await signInWithBiometricOn();
    const exchangesBefore = exchanges();
    const promptsBefore = localAuthenticationFake.promptCount;

    deepLinkState.url = GOOD_LINK;
    localAuthenticationFake.answers.push("user_cancel");
    const linkLaunch = await launchApp();
    expect(exchanges()).toBe(exchangesBefore + 1);
    expect(linkLaunch.text()).toContain(LOCKED_TITLE);
    expect(everRendered(SIGNED_IN_SCREEN)).toBe(false);
    expect(localAuthenticationFake.promptCount).toBe(promptsBefore + 1);

    await linkLaunch.press("Unlock");
    expect(linkLaunch.text()).toContain(SIGNED_IN_SCREEN);
  });

  it("a link that times out in the running, unlocked app never locks it: the timeout is not a sign-in", async () => {
    vi.useFakeTimers();
    const screen = await signInWithBiometricOn();
    const promptsBefore = localAuthenticationFake.promptCount;

    exchangeHangs = true;
    deepLinkState.url = GOOD_LINK;
    await screen.rerender();
    await vi.advanceTimersByTimeAsync(STARTUP_REQUEST_TIMEOUT_MS);
    await screen.rerender();
    expect(screen.text()).toContain(SIGNED_IN_SCREEN);
    expect(everRendered(LOCKED_TITLE)).toBe(false);
    expect(localAuthenticationFake.promptCount).toBe(promptsBefore);
  });
});
