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
const { STARTUP_REQUEST_TIMEOUT_MS } = await import("../auth/startupTimeout");
const { SERVER_UNREACHABLE_NOTE } = await import("../screens/EmailEntryScreen");

const SIGN_IN_SCREEN = "Sign in to BJJ Roll";
const SIGNED_IN_SCREEN = "You are signed in";
const TRY_AGAIN = "Try again";

describe("Fresh 10 s after startup, and Try again keeps a newer screen (HEN-310 gate)", () => {
  let backend: ReturnType<typeof createFakeBackend>;
  let secureStore: ReturnType<typeof createMemorySecureStore>;
  /** Paths (by ending) whose requests get no answer until the app aborts them, or until released. */
  let hangingPaths: Set<string>;
  /** Held requests by path ending; releasing one delivers the real backend answer. */
  let held: Map<string, (() => void)[]>;
  let holdInsteadOfHang: boolean;
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
  const noteCount = (screen: Awaited<ReturnType<typeof launchApp>>) => screen.text().split(SERVER_UNREACHABLE_NOTE).length - 1;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    backend = createFakeBackend();
    secureStore = createMemorySecureStore();
    hangingPaths = new Set();
    held = new Map();
    holdInsteadOfHang = false;
    unreachablePaths = new Set();
    deepLinkState.url = null;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(async () => {
    await settle();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("a sign-in after the startup budget ran out gets its own 10 s for the gate read", async () => {
    const screen = await launchApp();
    expect(screen.text()).toContain(SIGN_IN_SCREEN);
    // Startup finished long ago; its 10 s are spent.
    await advance(STARTUP_REQUEST_TIMEOUT_MS + 1000);
    await signIn(screen);
    expect(noteCount(screen)).toBe(0);
  });

  it("the gate's own Try again gets a fresh 10 s after the startup read timed out", async () => {
    await signIn(await launchApp());
    hangingPaths.add("/account/signup-attestation");
    const screen = await launchApp();
    await advance(STARTUP_REQUEST_TIMEOUT_MS);
    expect(screen.text()).toContain(TRY_AGAIN);
    hangingPaths.clear();
    await screen.press(TRY_AGAIN);
    expect(screen.text()).toContain(SIGNED_IN_SCREEN);
    expect(noteCount(screen)).toBe(0);
  });

  it("a code sent while Try again runs keeps the code screen when the retry answers", async () => {
    unreachablePaths.add("/get-session");
    const screen = await launchApp();
    expect(noteCount(screen)).toBe(1);
    unreachablePaths.clear();
    hangingPaths.add("/get-session");
    holdInsteadOfHang = true;
    await screen.press(TRY_AGAIN);
    await screen.pressRole("checkbox");
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    await screen.changeText("Email", "member@example.test");
    await screen.press("Continue with email");
    expect(screen.text()).toContain("We emailed a 6-digit code");
    held.get("/get-session")?.forEach((release) => release());
    await settle();
    expect(screen.text()).toContain("We emailed a 6-digit code");
    expect(screen.text()).not.toContain(SIGN_IN_SCREEN);
  });
});
