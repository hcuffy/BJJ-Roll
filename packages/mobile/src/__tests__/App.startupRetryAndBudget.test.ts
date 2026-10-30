import { SIGN_UP_ATTESTATION_LABEL } from "@bjj-roll/shared";
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
const { PENDING_SIGN_OUT_KEY, SESSION_STORAGE_KEYS } = await import("../auth/signInActions");
const { STARTUP_REQUEST_TIMEOUT_MS } = await import("../auth/startupTimeout");
const { SERVER_UNREACHABLE_NOTE } = await import("../screens/EmailEntryScreen");

const SIGN_IN_SCREEN = "Sign in to BJJ Roll";
const SIGNED_IN_SCREEN = "You are signed in";
const TRY_AGAIN = "Try again";
const SIGN_IN_LINK = "bjjroll://auth?code=one-time-exchange-code";
const OLDER_SESSION_MARKER = "better-auth.session_token=older-session.signature";

describe("Startup offline note: Try again and one shared 10 s budget (HEN-310)", () => {
  let backend: ReturnType<typeof createFakeBackend>;
  let secureStore: ReturnType<typeof createMemorySecureStore>;
  /** Paths (by ending) whose requests get no answer until the app aborts them, or until released. */
  let hangingPaths: Set<string>;
  /** Held requests by path ending; releasing one delivers the real backend answer. */
  let held: Map<string, (() => void)[]>;
  let holdInsteadOfHang: boolean;
  let abortedRequests: number;
  let unreachablePaths: Set<string>;
  let renderedScreens: string[] = [];

  const launchApp = async () => {
    appClient.store = secureStore;
    appClient.current = createMobileAuthClient({
      backendUrl: TEST_BACKEND_URL,
      storage: secureStore,
      fetchImplementation: vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = new Request(input, init).url;
        const hanging = [...hangingPaths].find((path) => url.endsWith(path));
        if (hanging) {
          return new Promise<Response>((resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              abortedRequests += 1;
              reject(new DOMException("Aborted", "AbortError"));
            });
            if (holdInsteadOfHang) {
              held.set(hanging, [...(held.get(hanging) ?? []), () => void backend.fetchImplementation(input, init).then(resolve, reject)]);
            }
          });
        }
        if ([...unreachablePaths].some((path) => url.endsWith(path))) {
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
  const advance = async (milliseconds: number) => {
    await vi.advanceTimersByTimeAsync(milliseconds);
    await settle();
  };
  const requestsTo = (path: string) => backend.requests.filter((request) => request.url.endsWith(path)).length;
  const noteCount = (screen: Awaited<ReturnType<typeof launchApp>>) => screen.text().split(SERVER_UNREACHABLE_NOTE).length - 1;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    backend = createFakeBackend();
    secureStore = createMemorySecureStore();
    hangingPaths = new Set();
    held = new Map();
    holdInsteadOfHang = false;
    abortedRequests = 0;
    unreachablePaths = new Set();
    deepLinkState.url = null;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(async () => {
    await settle();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("Try again under the startup note", () => {
    it("re-runs the startup check and, on success, clears the note and lands where startup would", async () => {
      await signIn(await launchApp());
      unreachablePaths.add("/get-session");
      const screen = await launchApp();
      expect(screen.text()).toContain(SIGN_IN_SCREEN);
      expect(noteCount(screen)).toBe(1);
      expect(screen.getPressable(TRY_AGAIN).props.accessibilityRole).toBe("button");

      unreachablePaths.clear();
      const sessionReadsBefore = requestsTo("/get-session");
      await screen.press(TRY_AGAIN);

      expect(requestsTo("/get-session")).toBe(sessionReadsBefore + 1);
      expect(screen.text()).toContain(SIGNED_IN_SCREEN);
      expect(screen.text()).not.toContain(SERVER_UNREACHABLE_NOTE);
    });

    it("signed out: a successful retry removes the note and the button and stays on sign-in", async () => {
      unreachablePaths.add("/get-session");
      const screen = await launchApp();
      expect(noteCount(screen)).toBe(1);

      unreachablePaths.clear();
      await screen.press(TRY_AGAIN);

      expect(screen.text()).toContain(SIGN_IN_SCREEN);
      expect(screen.text()).not.toContain(SERVER_UNREACHABLE_NOTE);
      expect(screen.text()).not.toContain(TRY_AGAIN);
    });

    it("is busy while the retry runs, ignores a second tap, and on failure keeps the note and stays usable", async () => {
      await signIn(await launchApp());
      unreachablePaths.add("/get-session");
      const screen = await launchApp();
      unreachablePaths.clear();
      hangingPaths.add("/get-session");
      const sessionReadsBefore = requestsTo("/get-session");

      await screen.press(TRY_AGAIN);
      const busyButton = screen.getPressable("Trying again");
      expect(busyButton.props.accessibilityState).toEqual({ disabled: true, busy: true });
      await screen.press("Trying again");
      (busyButton.props.onPress as () => void)();
      await settle();
      expect(abortedRequests).toBe(0);

      await advance(STARTUP_REQUEST_TIMEOUT_MS);
      expect(abortedRequests).toBe(1);
      expect(screen.text()).toContain(SIGN_IN_SCREEN);
      expect(noteCount(screen)).toBe(1);
      expect(screen.isDisabled(TRY_AGAIN)).toBe(false);

      hangingPaths.clear();
      await screen.press(TRY_AGAIN);
      expect(requestsTo("/get-session")).toBe(sessionReadsBefore + 1);
      expect(screen.text()).toContain(SIGNED_IN_SCREEN);
    });

    it("is not shown for a note that a send brought up", async () => {
      const screen = await launchApp();
      unreachablePaths.add("/email-otp/send-verification-otp");
      await screen.pressRole("checkbox");
      await screen.press(SIGN_UP_ATTESTATION_LABEL);
      await screen.changeText("Email", "member@example.test");
      await screen.press("Continue with email");
      expect(noteCount(screen)).toBe(1);
      expect(screen.text()).not.toContain(TRY_AGAIN);
    });
  });

  describe("one 10 s budget for all of startup", () => {
    it("with every startup step hanging, Loading ends at 10 s in total, not 20 s", async () => {
      await signIn(await launchApp());
      hangingPaths.add("/get-session");
      hangingPaths.add("/magic-link/exchange");
      deepLinkState.url = SIGN_IN_LINK;

      const screen = await launchApp();
      await advance(STARTUP_REQUEST_TIMEOUT_MS - 1);
      expect(screen.text()).toContain("Loading");
      await advance(1);

      expect(screen.text()).not.toContain("Loading");
      expect(screen.text()).toContain(SIGN_IN_SCREEN);
      expect(noteCount(screen)).toBe(1);
    });

    it("the gate's status read hangs: it gives up inside the same 10 s and offers its retry with the offline note", async () => {
      await signIn(await launchApp());
      hangingPaths.add("/get-session");
      hangingPaths.add("/account/signup-attestation");
      holdInsteadOfHang = true;

      const screen = await launchApp();
      // The session read answers after 6 s; the gate then has only the 4 s left.
      await advance(6000);
      held.get("/get-session")?.forEach((release) => release());
      await settle();
      expect(screen.text()).toContain("Loading");
      await advance(STARTUP_REQUEST_TIMEOUT_MS - 6000 - 1);
      expect(screen.text()).toContain("Loading");
      await advance(1);

      expect(screen.text()).not.toContain("Loading");
      expect(noteCount(screen)).toBe(1);
      expect(screen.text()).toContain(TRY_AGAIN);
      expect(screen.text()).toContain("Sign out");
      expect(renderedScreens.some((text) => text.includes(SIGN_IN_SCREEN))).toBe(false);
    });

    it("a gate status read after a sign-in in the running app also gives up after 10 s", async () => {
      hangingPaths.add("/account/signup-attestation");
      const screen = await launchApp();
      await screen.pressRole("checkbox");
      await screen.press(SIGN_UP_ATTESTATION_LABEL);
      await screen.changeText("Email", "member@example.test");
      await screen.press("Continue with email");
      await screen.changeText("6-digit code", "123456");
      expect(screen.text()).toContain("Loading");

      await advance(STARTUP_REQUEST_TIMEOUT_MS);

      expect(screen.text()).not.toContain("Loading");
      expect(noteCount(screen)).toBe(1);
      expect(screen.text()).toContain(TRY_AGAIN);
    });
  });

  describe("the old-session sign-out at launch (newer session stored)", () => {
    it("a hanging server never holds up start: the signed-in app shows, and the marker is kept when the revoke times out", async () => {
      await signIn(await launchApp());
      await secureStore.setItemAsync(PENDING_SIGN_OUT_KEY, OLDER_SESSION_MARKER);
      hangingPaths.add("/sign-out");
      holdInsteadOfHang = true;

      const screen = await launchApp();
      expect(screen.text()).toContain(SIGNED_IN_SCREEN);

      await advance(STARTUP_REQUEST_TIMEOUT_MS);
      expect(abortedRequests).toBe(1);
      // A late answer changes nothing: the revoke counts as failed and the next launch retries it.
      held.get("/sign-out")?.forEach((release) => release());
      await settle();
      expect(secureStore.items.get(PENDING_SIGN_OUT_KEY)).toBe(OLDER_SESSION_MARKER);
      expect(screen.text()).toContain(SIGNED_IN_SCREEN);
      expect(renderedScreens.some((text) => text.includes(SIGN_IN_SCREEN))).toBe(false);
    });
  });

  describe("sign-out tapped while the server hangs", () => {
    it("completes on the phone within the timeout and keeps the marker for the next launch", async () => {
      const screen = await launchApp();
      await signIn(screen);
      hangingPaths.add("/sign-out");

      await screen.press("Sign out");
      expect(SESSION_STORAGE_KEYS.some((key) => secureStore.items.has(key))).toBe(false);
      await advance(STARTUP_REQUEST_TIMEOUT_MS - 1);
      expect(screen.text()).toContain("Loading");
      await advance(1);

      expect(screen.text()).toContain(SIGN_IN_SCREEN);
      expect(abortedRequests).toBe(1);
      expect(secureStore.items.has(PENDING_SIGN_OUT_KEY)).toBe(true);
    });
  });
});
