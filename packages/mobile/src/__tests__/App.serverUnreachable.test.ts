import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMobileAuthClient, type MobileAuthClient } from "../auth/authClient";
import { colours } from "../theme/tokens";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL, TEST_DELETE_CODE } from "./authTestDoubles";
import { deepLinkState, flattenStyle, renderScreen } from "./screenHarness";

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
// The real actions by default; a test can make one reject outright, as an unexpected error would.
vi.mock("../auth/signInActions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth/signInActions")>();
  return { ...actual, completeMagicLink: vi.fn(actual.completeMagicLink), signOut: vi.fn(actual.signOut) };
});

const { App } = await import("../App");
const { completeMagicLink, signOut } = await import("../auth/signInActions");
const { SERVER_UNREACHABLE_NOTE } = await import("../screens/EmailEntryScreen");

describe("App when the server cannot be reached (HEN-285)", () => {
  let backend: ReturnType<typeof createFakeBackend>;
  let secureStore: ReturnType<typeof createMemorySecureStore>;
  let serverDown: boolean;
  const unhandledRejections: unknown[] = [];
  const recordUnhandled = (reason: unknown) => unhandledRejections.push(reason);

  const startApp = async () => {
    appClient.store = secureStore;
    appClient.current = createMobileAuthClient({
      backendUrl: TEST_BACKEND_URL,
      storage: secureStore,
      // What React Native's fetch does when 10.0.2.2:3000 is not listening.
      fetchImplementation: vi.fn((input: string | URL | Request, init?: RequestInit) =>
        serverDown ? Promise.reject(new TypeError("fetch failed")) : backend.fetchImplementation(input, init),
      ),
    });
    return await renderScreen(createElement(App));
  };
  const startSignedIn = async () => {
    const screen = await startApp();
    await screen.pressRole("checkbox");
    await screen.changeText("Email", "member@example.test");
    await screen.press("Continue");
    await screen.changeText("6-digit code", "123456");
    return screen;
  };

  beforeEach(() => {
    backend = createFakeBackend();
    secureStore = createMemorySecureStore();
    serverDown = true;
    deepLinkState.url = null;
    unhandledRejections.length = 0;
    process.on("unhandledRejection", recordUnhandled);
  });
  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.off("unhandledRejection", recordUnhandled);
    expect(unhandledRejections).toEqual([]);
  });

  it("startup: leaves Loading for the sign-in screen with a calm, announced note under the email field", async () => {
    const screen = await startApp();

    expect(screen.text()).not.toContain("Loading");
    expect(screen.text()).toContain("Sign in to BJJ Roll");
    const note = screen.queryByText(SERVER_UNREACHABLE_NOTE);
    expect(note?.props).toMatchObject({ accessibilityLiveRegion: "polite" });
    // Calm, not an alert: TalkBack must not read it as one (Vera, round 2 item 1).
    expect(note?.props.accessibilityRole).toBeUndefined();
    // Muted body text, not the red error style.
    expect(flattenStyle(note?.props.style)).toMatchObject({ fontSize: 15, lineHeight: 22, color: colours.textSecondary });
    expect(flattenStyle(note?.props.style).color).not.toBe(colours.danger);
    // Under the email field, above the 17+ box.
    expect(screen.text().indexOf(SERVER_UNREACHABLE_NOTE)).toBeGreaterThan(screen.text().indexOf("Email"));
    expect(screen.text().indexOf(SERVER_UNREACHABLE_NOTE)).toBeLessThan(screen.text().indexOf("17 or older"));
  });

  it("field errors next to the note are still announced as alerts", async () => {
    const screen = await startApp();
    await screen.changeText("Email", "not-an-email");
    await screen.fire("Email", "onBlur");

    expect(screen.text()).toContain(SERVER_UNREACHABLE_NOTE);
    expect(screen.queryByText("Enter a valid email address.")?.props).toMatchObject({
      accessibilityRole: "alert",
      accessibilityLiveRegion: "polite",
    });
  });

  it("retry: once the server is back, Continue sends the code without a restart and the note is gone", async () => {
    const screen = await startApp();
    expect(screen.text()).toContain(SERVER_UNREACHABLE_NOTE);

    serverDown = false;
    await screen.pressRole("checkbox");
    await screen.changeText("Email", "member@example.test");
    expect(screen.text()).toContain(SERVER_UNREACHABLE_NOTE);
    await screen.press("Continue");

    expect(screen.text()).toContain("Enter your code");
    expect(screen.text()).not.toContain(SERVER_UNREACHABLE_NOTE);
  });

  it("the note clears on the next submit attempt, even if that attempt fails too", async () => {
    const screen = await startApp();
    await screen.pressRole("checkbox");
    await screen.changeText("Email", "member@example.test");
    await screen.press("Continue");

    expect(screen.text()).not.toContain(SERVER_UNREACHABLE_NOTE);
    expect(screen.text()).toContain("Sign in to BJJ Roll");
  });

  it("magic link: a rejected link exchange lands on the sign-in screen with the same note, no hang", async () => {
    vi.mocked(completeMagicLink).mockRejectedValueOnce(new TypeError("fetch failed"));
    deepLinkState.url = "bjjroll://auth?code=one-time-exchange-code";
    const screen = await startApp();

    expect(screen.text()).toContain("Sign in to BJJ Roll");
    expect(screen.text()).toContain(SERVER_UNREACHABLE_NOTE);
  });

  it("magic link: the server going down during the exchange shows the same note instead of the link error", async () => {
    serverDown = false;
    const backendUp = backend.fetchImplementation.getMockImplementation();
    backend.fetchImplementation.mockImplementation((input, init) =>
      new Request(input, init).url.endsWith("/magic-link/exchange")
        ? Promise.reject(new TypeError("fetch failed"))
        : (backendUp?.(input, init) ?? Promise.reject(new Error("no backend"))),
    );
    deepLinkState.url = "bjjroll://auth?code=one-time-exchange-code";
    const screen = await startApp();

    expect(screen.text()).toContain("Sign in to BJJ Roll");
    expect(screen.text()).toContain(SERVER_UNREACHABLE_NOTE);
    expect(screen.text()).not.toContain("You are signed in");
    expect(screen.text()).not.toContain("No connection.");
  });

  it("sign-out with the server down clears the local session and shows the sign-in screen", async () => {
    serverDown = false;
    const screen = await startSignedIn();
    expect(screen.text()).toContain("You are signed in");

    serverDown = true;
    await screen.press("Sign out");

    expect(screen.text()).toContain("Sign in to BJJ Roll");
    expect(secureStore.items.has("bjjroll_cookie")).toBe(false);
    expect(secureStore.items.has("bjjroll_session_data")).toBe(false);
    // The user asked to sign out and is signed out on this phone, so no server note here.
    expect(screen.text()).not.toContain(SERVER_UNREACHABLE_NOTE);
  });

  it("a link that fails while signed in does not leave a stale note after sign-out", async () => {
    serverDown = false;
    const screen = await startSignedIn();
    expect(screen.text()).toContain("You are signed in");

    const backendUp = backend.fetchImplementation.getMockImplementation();
    backend.fetchImplementation.mockImplementation((input, init) =>
      new Request(input, init).url.endsWith("/magic-link/exchange")
        ? Promise.reject(new TypeError("fetch failed"))
        : (backendUp?.(input, init) ?? Promise.reject(new Error("no backend"))),
    );
    deepLinkState.url = "bjjroll://auth?code=one-time-exchange-code";
    await screen.rerender();
    expect(screen.text()).toContain("You are signed in");

    await screen.press("Sign out");

    expect(screen.text()).toContain("Sign in to BJJ Roll");
    expect(screen.text()).not.toContain(SERVER_UNREACHABLE_NOTE);
  });

  it("signing in clears the startup note, so it is gone when the user is back on sign-in after deleting the account", async () => {
    const screen = await startApp();
    expect(screen.text()).toContain(SERVER_UNREACHABLE_NOTE);

    // Server back; the user opens a sign-in link from an earlier email, so no submit clears the note first.
    serverDown = false;
    deepLinkState.url = "bjjroll://auth?code=one-time-exchange-code";
    await screen.rerender();
    expect(screen.text()).toContain("You are signed in");

    await screen.press("Delete account");
    await screen.press("Email me a code");
    await screen.changeText("6-digit code", TEST_DELETE_CODE);
    await screen.press("Delete my account");

    expect(screen.text()).toContain("Sign in to BJJ Roll");
    expect(screen.text()).not.toContain(SERVER_UNREACHABLE_NOTE);
  });

  it("sign-out that rejects outright still lands on the sign-in screen, no hang", async () => {
    serverDown = false;
    const screen = await startSignedIn();
    expect(screen.text()).toContain("You are signed in");

    vi.mocked(signOut).mockRejectedValueOnce(new Error("SecureStore unavailable"));
    await screen.press("Sign out");

    expect(screen.text()).toContain("Sign in to BJJ Roll");
  });
});
