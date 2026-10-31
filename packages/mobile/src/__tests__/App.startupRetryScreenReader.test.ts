import { SIGN_UP_ATTESTATION_LABEL } from "@bjj-roll/shared";
import { createElement } from "react";
import { AccessibilityInfo, Platform } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMobileAuthClient, type MobileAuthClient } from "../auth/authClient";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL } from "./authTestDoubles";
import { deepLinkState, flattenStyle, renderScreen, settle, textOf } from "./screenHarness";

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

const TRY_AGAIN = "Try again";
const SEND_CODE_PATH = "/email-otp/send-verification-otp";

describe("Startup Try again for screen readers (HEN-310)", () => {
  let backend: ReturnType<typeof createFakeBackend>;
  let secureStore: ReturnType<typeof createMemorySecureStore>;
  let hangingPaths: Set<string>;
  let held: Map<string, (() => void)[]>;
  let holdInsteadOfHang: boolean;
  let unreachablePaths: Set<string>;

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
    return await renderScreen(createElement(App));
  };
  const launchOffline = async () => {
    unreachablePaths.add("/get-session");
    const screen = await launchApp();
    expect(screen.text()).toContain(TRY_AGAIN);
    vi.mocked(AccessibilityInfo.announceForAccessibility).mockClear();
    vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
    return screen;
  };
  const continueWithEmailOffline = async (screen: Awaited<ReturnType<typeof launchApp>>) => {
    unreachablePaths.add(SEND_CODE_PATH);
    await screen.pressRole("checkbox");
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    await screen.changeText("Email", "member@example.test");
    await screen.press("Continue with email");
  };
  const noteAnnouncements = () =>
    vi.mocked(AccessibilityInfo.announceForAccessibility).mock.calls.filter(([text]) => text === SERVER_UNREACHABLE_NOTE).length;
  const emailFocusMoves = () =>
    vi
      .mocked(AccessibilityInfo.sendAccessibilityEvent)
      .mock.calls.filter(
        ([target, event]) =>
          (target as unknown as { props: { accessibilityLabel?: string } }).props.accessibilityLabel === "Email" && event === "focus",
      ).length;

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
    Platform.OS = "android";
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each(["ios", "android"] as const)("%s: each failed retry announces the note once, and a successful one announces nothing", async (platform) => {
    Platform.OS = platform;
    const screen = await launchOffline();

    await screen.press(TRY_AGAIN);
    expect(noteAnnouncements()).toBe(1);
    await screen.press(TRY_AGAIN);
    expect(noteAnnouncements()).toBe(2);

    unreachablePaths.clear();
    await screen.press(TRY_AGAIN);
    expect(screen.text()).not.toContain(SERVER_UNREACHABLE_NOTE);
    expect(noteAnnouncements()).toBe(2);
  });

  it("Try again says what it retries and sits 8 under the note, in a group only while it shows", async () => {
    const screen = await launchOffline();
    expect(screen.getPressable(TRY_AGAIN).props.accessibilityHint).toBe("Checks the connection to the server again.");
    const group = screen
      .findAllByType("View")
      .filter((node) => textOf(node).includes(SERVER_UNREACHABLE_NOTE))
      .at(-1);
    expect(textOf(group!)).toContain(TRY_AGAIN);
    expect(flattenStyle(group!.props.style).gap).toBe(8);

    await continueWithEmailOffline(screen);
    expect(screen.text()).toContain(SERVER_UNREACHABLE_NOTE);
    const groups = screen.findAllByType("View").filter((node) => textOf(node).includes(SERVER_UNREACHABLE_NOTE));
    expect(groups.some((node) => flattenStyle(node.props.style).gap === 8)).toBe(false);
  });

  it("a retry that reaches the server moves screen-reader focus to the Email field; a failed one does not", async () => {
    const screen = await launchOffline();
    await screen.press(TRY_AGAIN);
    expect(emailFocusMoves()).toBe(0);

    unreachablePaths.clear();
    await screen.press(TRY_AGAIN);
    expect(screen.text()).not.toContain(TRY_AGAIN);
    expect(emailFocusMoves()).toBe(1);
  });

  it("Continue with email removes Try again, and a retry that fails afterwards does not bring it back or re-announce", async () => {
    const screen = await launchOffline();
    unreachablePaths.delete("/get-session");
    hangingPaths.add("/get-session");
    await screen.press(TRY_AGAIN);

    await continueWithEmailOffline(screen);
    expect(screen.text()).not.toContain(TRY_AGAIN);
    vi.mocked(AccessibilityInfo.announceForAccessibility).mockClear();

    await vi.advanceTimersByTimeAsync(STARTUP_REQUEST_TIMEOUT_MS);
    await settle();
    expect(screen.text()).toContain("Sign in to BJJ Roll");
    expect(screen.text()).not.toContain(TRY_AGAIN);
    expect(noteAnnouncements()).toBe(0);
  });

  it("Continue with email removes Try again, and a retry that answers afterwards neither brings it back nor moves focus", async () => {
    const screen = await launchOffline();
    unreachablePaths.delete("/get-session");
    hangingPaths.add("/get-session");
    holdInsteadOfHang = true;
    await screen.press(TRY_AGAIN);

    await continueWithEmailOffline(screen);
    expect(screen.text()).not.toContain(TRY_AGAIN);

    held.get("/get-session")?.forEach((release) => release());
    await settle();
    expect(held.get("/get-session")).toHaveLength(1);
    expect(screen.text()).toContain("Sign in to BJJ Roll");
    expect(screen.text()).not.toContain(TRY_AGAIN);
    expect(emailFocusMoves()).toBe(0);
  });
});
