import { SIGN_UP_ATTESTATION_LABEL } from "@bjj-roll/shared";
import { inspect } from "node:util";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMobileAuthClient, type MobileAuthClient } from "../auth/authClient";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL } from "./authTestDoubles";
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
const { PENDING_SIGN_OUT_KEY } = await import("../auth/signInActions");
const { STARTUP_REQUEST_TIMEOUT_MS } = await import("../auth/startupTimeout");
const { SERVER_UNREACHABLE_NOTE } = await import("../screens/EmailEntryScreen");

const SIGN_IN_SCREEN = "Sign in to BJJ Roll";
const SIGNED_IN_SCREEN = "You are signed in";
const SIGN_IN_LINK = "bjjroll://auth?code=one-time-exchange-code";

/** How a request to a host that does not answer behaves: React Native's fetch only ends it when the app aborts it. */
type HangMode = "untilAborted" | "answersLate";

describe("Loading never hangs when the server host does not answer (HEN-303)", () => {
  let backend: ReturnType<typeof createFakeBackend>;
  let secureStore: ReturnType<typeof createMemorySecureStore>;
  /** Paths (by ending) whose requests get no answer. */
  let hangingPaths: Set<string>;
  let hangMode: HangMode;
  /** Late answers held back in "answersLate" mode; releasing them delivers the real backend response. */
  let lateAnswers: (() => void)[];
  /** Hanging requests the app aborted at its deadline. */
  let abortedRequests: number;
  let signOutEndpointDown: boolean;
  let renderedScreens: string[] = [];
  const unhandledRejections: unknown[] = [];
  const recordUnhandled = (reason: unknown) => unhandledRejections.push(reason);
  let consoleSpies: { readonly mock: { readonly calls: readonly (readonly unknown[])[] } }[] = [];

  const hangingFetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> =>
    new Promise((resolve, reject) => {
      if (hangMode === "answersLate") {
        lateAnswers.push(() => void backend.fetchImplementation(input, init).then(resolve, reject));
        return;
      }
      init?.signal?.addEventListener("abort", () => {
        abortedRequests += 1;
        reject(new DOMException("Aborted", "AbortError"));
      });
    });

  const launchApp = async () => {
    appClient.store = secureStore;
    appClient.current = createMobileAuthClient({
      backendUrl: TEST_BACKEND_URL,
      storage: secureStore,
      fetchImplementation: vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = new Request(input, init).url;
        if ([...hangingPaths].some((path) => url.endsWith(path))) {
          return hangingFetch(input, init);
        }
        if (signOutEndpointDown && url.endsWith("/sign-out")) {
          return Promise.reject(new TypeError("fetch failed"));
        }
        return backend.fetchImplementation(input, init);
      }),
    });
    renderedScreens = [];
    return await renderScreen(createElement(App), (text) => renderedScreens.push(text));
  };
  const signIn = async (screen: Awaited<ReturnType<typeof launchApp>>) => {
    await screen.pressRole("checkbox");
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    await screen.changeText("Email", "member@example.test");
    await screen.press("Continue with email");
    await screen.changeText("6-digit code", "123456");
    expect(screen.text()).toContain(SIGNED_IN_SCREEN);
  };
  /** Signed in, then sign-out cannot reach the server: the sign-out is left for the next launch (HEN-286). */
  const leaveSignOutPending = async () => {
    const screen = await launchApp();
    await signIn(screen);
    signOutEndpointDown = true;
    await screen.press("Sign out");
    signOutEndpointDown = false;
    expect(secureStore.items.has(PENDING_SIGN_OUT_KEY)).toBe(true);
  };
  const signOutRequestCount = () => backend.requests.filter((request) => request.url.endsWith("/sign-out")).length;
  const advance = async (milliseconds: number) => {
    await vi.advanceTimersByTimeAsync(milliseconds);
    await settle();
  };
  /** Loading stays up until the timeout, and not a moment longer. */
  const expectLoadingEndsAtTimeout = async (screen: Awaited<ReturnType<typeof launchApp>>) => {
    expect(screen.text()).toContain("Loading");
    await advance(STARTUP_REQUEST_TIMEOUT_MS - 1);
    expect(screen.text()).toContain("Loading");
    await advance(1);
    expect(screen.text()).not.toContain("Loading");
  };
  const expectCalmOfflineNote = (screen: Awaited<ReturnType<typeof launchApp>>) => {
    expect(screen.text()).toContain(SIGN_IN_SCREEN);
    expect(screen.text().split(SERVER_UNREACHABLE_NOTE)).toHaveLength(2);
    expect(screen.queryByText(SERVER_UNREACHABLE_NOTE)?.props.accessibilityRole).toBeUndefined();
    expect(screen.text()).not.toContain("No connection.");
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    backend = createFakeBackend();
    secureStore = createMemorySecureStore();
    hangingPaths = new Set();
    hangMode = "untilAborted";
    lateAnswers = [];
    abortedRequests = 0;
    signOutEndpointDown = false;
    deepLinkState.url = null;
    unhandledRejections.length = 0;
    process.on("unhandledRejection", recordUnhandled);
    consoleSpies = (["log", "info", "warn", "error"] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => undefined));
  });
  afterEach(async () => {
    await settle();
    vi.useRealTimers();
    process.off("unhandledRejection", recordUnhandled);
    expect(unhandledRejections).toEqual([]);
    const logged = consoleSpies
      .flatMap((spy) => spy.mock.calls.flat<readonly (readonly unknown[])[]>())
      .map((value) => inspect(value, { depth: 8 }))
      .join("\n");
    for (const secret of ["signed-session-value", "raw-session-token", "one-time-exchange-code", "123456", "member@example.test"]) {
      expect(logged).not.toContain(secret);
    }
    vi.restoreAllMocks();
  });

  it("the timeout is a fixed, named value", () => {
    expect(STARTUP_REQUEST_TIMEOUT_MS).toBe(10_000);
  });

  describe("pending sign-out retry gets no answer", () => {
    it("Loading ends at the timeout on the sign-in screen with the calm note, and the retry stays pending", async () => {
      await leaveSignOutPending();
      hangingPaths.add("/sign-out");
      const signOutsBefore = signOutRequestCount();

      const screen = await launchApp();
      await expectLoadingEndsAtTimeout(screen);

      expectCalmOfflineNote(screen);
      // The retry presents the old session cookie (HEN-299) and that request is aborted at the deadline.
      expect(abortedRequests).toBe(1);
      expect(secureStore.items.has(PENDING_SIGN_OUT_KEY)).toBe(true);
      // The next launch with a reachable server finishes it.
      hangingPaths.clear();
      expect((await launchApp()).text()).toContain(SIGN_IN_SCREEN);
      expect(signOutRequestCount()).toBe(signOutsBefore + 1);
      expect(secureStore.items.has(PENDING_SIGN_OUT_KEY)).toBe(false);
    });

    it("an answer after the timeout changes nothing: same screen, one note, the retry still pending", async () => {
      await leaveSignOutPending();
      hangingPaths.add("/sign-out");
      hangMode = "answersLate";

      const screen = await launchApp();
      await expectLoadingEndsAtTimeout(screen);
      const screensAtTimeout = renderedScreens.length;

      lateAnswers.forEach((answer) => answer());
      await settle();

      expectCalmOfflineNote(screen);
      expect(renderedScreens.slice(screensAtTimeout).every((text) => text === renderedScreens[screensAtTimeout - 1])).toBe(true);
      expect(secureStore.items.has(PENDING_SIGN_OUT_KEY)).toBe(true);
    });

    it("ending an older session left by a sign-in (HEN-299) times out: the marker stays even if the server answers late", async () => {
      await signIn(await launchApp());
      const olderSessionMarker = "better-auth.session_token=older-session.signature";
      await secureStore.setItemAsync(PENDING_SIGN_OUT_KEY, olderSessionMarker);
      hangingPaths.add("/sign-out");
      hangMode = "answersLate";

      const screen = await launchApp();
      await expectLoadingEndsAtTimeout(screen);
      lateAnswers.forEach((answer) => answer());
      await settle();

      expectCalmOfflineNote(screen);
      expect(secureStore.items.get(PENDING_SIGN_OUT_KEY)).toBe(olderSessionMarker);
      // The stored session was never touched: a reachable launch ends the older one and keeps the user signed in.
      hangingPaths.clear();
      expect((await launchApp()).text()).toContain(SIGNED_IN_SCREEN);
      expect(secureStore.items.has(PENDING_SIGN_OUT_KEY)).toBe(false);
    });
  });

  describe("session read gets no answer", () => {
    it("Loading ends at the timeout on the sign-in screen with the calm note, as when the server is down", async () => {
      await signIn(await launchApp());
      hangingPaths.add("/get-session");

      const screen = await launchApp();
      await expectLoadingEndsAtTimeout(screen);

      expectCalmOfflineNote(screen);
    });

    it("an answer after the timeout does not switch to the signed-in screen", async () => {
      await signIn(await launchApp());
      hangingPaths.add("/get-session");
      hangMode = "answersLate";

      const screen = await launchApp();
      await expectLoadingEndsAtTimeout(screen);
      lateAnswers.forEach((answer) => answer());
      await settle();

      expectCalmOfflineNote(screen);
      expect(renderedScreens.some((text) => text.includes(SIGNED_IN_SCREEN))).toBe(false);
    });
  });

  describe("cold-start sign-in link exchange gets no answer", () => {
    it("Loading ends at the timeout on the sign-in screen with the calm note, not a red error", async () => {
      hangingPaths.add("/magic-link/exchange");
      deepLinkState.url = SIGN_IN_LINK;

      const screen = await launchApp();
      await expectLoadingEndsAtTimeout(screen);

      expectCalmOfflineNote(screen);
      expect(screen.text()).not.toContain("expired");
      expect(renderedScreens.some((text) => text.includes(SIGNED_IN_SCREEN))).toBe(false);
    });

    it("an answer after the timeout does not switch to the signed-in screen", async () => {
      hangingPaths.add("/magic-link/exchange");
      hangMode = "answersLate";
      deepLinkState.url = SIGN_IN_LINK;

      const screen = await launchApp();
      await expectLoadingEndsAtTimeout(screen);
      lateAnswers.forEach((answer) => answer());
      await settle();

      expectCalmOfflineNote(screen);
      expect(renderedScreens.some((text) => text.includes(SIGNED_IN_SCREEN))).toBe(false);
    });
  });
});
