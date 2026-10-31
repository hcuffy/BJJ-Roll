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
const TRY_AGAIN = "Try again";
const SIGN_IN_LINK = "bjjroll://auth?code=one-time-exchange-code";

describe("A cold sign-in link and the gate read share the startup 10 s (HEN-310 gate, merge 8a78fca)", () => {
  let backend: ReturnType<typeof createFakeBackend>;
  let secureStore: ReturnType<typeof createMemorySecureStore>;
  let hangingPaths: Set<string>;
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
            init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
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
    unreachablePaths = new Set();
    deepLinkState.url = null;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(async () => {
    await settle();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("a sign-in link at launch answers after 6 s: the hanging gate read gives up 4 s later, not after a fresh 10 s", async () => {
    hangingPaths.add("/magic-link/exchange");
    hangingPaths.add("/account/signup-attestation");
    holdInsteadOfHang = true;
    deepLinkState.url = SIGN_IN_LINK;

    const screen = await launchApp();
    await advance(6000);
    held.get("/magic-link/exchange")?.forEach((release) => release());
    await settle();
    expect(requestsTo("/magic-link/exchange")).toBe(1);
    expect(screen.text()).toContain("Loading");
    await advance(STARTUP_REQUEST_TIMEOUT_MS - 6000 - 1);
    expect(screen.text()).toContain("Loading");
    await advance(1);

    expect(screen.text()).not.toContain("Loading");
    expect(noteCount(screen)).toBe(1);
    expect(screen.text()).toContain(TRY_AGAIN);
    expect(renderedScreens.some((text) => text.includes(SIGN_IN_SCREEN))).toBe(false);
  });
});
