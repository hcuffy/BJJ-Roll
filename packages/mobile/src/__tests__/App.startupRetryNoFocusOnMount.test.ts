import { createElement } from "react";
import { AccessibilityInfo, Platform } from "react-native";
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
const { SERVER_UNREACHABLE_NOTE } = await import("../screens/EmailEntryScreen");

const SIGN_IN_SCREEN = "Sign in to BJJ Roll";
const TRY_AGAIN = "Try again";

describe("Startup Try again: a fresh sign-in screen keeps focus and announces the note once (HEN-310 gate)", () => {
  let backend: ReturnType<typeof createFakeBackend>;
  let secureStore: ReturnType<typeof createMemorySecureStore>;
  let unreachablePaths: Set<string>;

  const launchApp = async () => {
    appClient.store = secureStore;
    appClient.current = createMobileAuthClient({
      backendUrl: TEST_BACKEND_URL,
      storage: secureStore,
      fetchImplementation: vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = new Request(input, init).url;
        if ([...unreachablePaths].some((path) => url.endsWith(path))) {
          return Promise.reject(new TypeError("fetch failed"));
        }
        return backend.fetchImplementation(input, init);
      }),
    });
    return await renderScreen(createElement(App));
  };
  const emailFocusMoves = () =>
    vi
      .mocked(AccessibilityInfo.sendAccessibilityEvent)
      .mock.calls.filter(
        ([target, event]) =>
          (target as unknown as { props: { accessibilityLabel?: string } }).props.accessibilityLabel === "Email" && event === "focus",
      ).length;
  const noteAnnouncements = () =>
    vi.mocked(AccessibilityInfo.announceForAccessibility).mock.calls.filter(([text]) => text === SERVER_UNREACHABLE_NOTE).length;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    backend = createFakeBackend();
    secureStore = createMemorySecureStore();
    unreachablePaths = new Set();
    deepLinkState.url = null;
    vi.mocked(AccessibilityInfo.announceForAccessibility).mockClear();
    vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(async () => {
    await settle();
    Platform.OS = "android";
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("opening sign-in normally does not move screen-reader focus to the Email field", async () => {
    const screen = await launchApp();
    expect(screen.text()).toContain(SIGN_IN_SCREEN);
    expect(emailFocusMoves()).toBe(0);
  });

  it("opening sign-in with the startup note and Try again does not move focus", async () => {
    unreachablePaths.add("/get-session");
    const screen = await launchApp();
    expect(screen.text()).toContain(TRY_AGAIN);
    expect(emailFocusMoves()).toBe(0);
  });

  it.each([
    ["ios", 1],
    ["android", 0],
  ] as const)("%s: the startup note is announced %i time(s) explicitly at launch, before any retry", async (platform, expected) => {
    Platform.OS = platform;
    unreachablePaths.add("/get-session");
    const screen = await launchApp();
    expect(screen.text()).toContain(TRY_AGAIN);
    expect(noteAnnouncements()).toBe(expected);
  });
});
