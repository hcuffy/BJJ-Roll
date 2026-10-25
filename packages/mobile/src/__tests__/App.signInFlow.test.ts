import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMobileAuthClient, type MobileAuthClient } from "../auth/authClient";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL } from "./authTestDoubles";
import { colours } from "../theme/tokens";
import { deepLinkState, flattenStyle, type HostNode, renderScreen, textOf } from "./screenHarness";

// The app's real client reads Expo config and SecureStore; here it talks to a fake backend and an in-memory store.
const appClient = vi.hoisted(() => ({ current: null as MobileAuthClient | null, store: null as ReturnType<typeof createMemorySecureStore> | null }));
vi.mock("../auth/appAuthClient", () => ({
  get appAuthClient() {
    return appClient.current;
  },
  get appSecureStore() {
    return appClient.store;
  },
}));

const { App } = await import("../App");

describe("App sign-in flow (Android, fake backend)", () => {
  let backend: ReturnType<typeof createFakeBackend>;
  let secureStore: ReturnType<typeof createMemorySecureStore>;

  const startApp = async () => {
    appClient.store = secureStore;
    appClient.current = createMobileAuthClient({
      backendUrl: TEST_BACKEND_URL,
      storage: secureStore,
      fetchImplementation: backend.fetchImplementation,
    });
    return await renderScreen(createElement(App));
  };
  // better-auth refetches get-session after each sign-in; only the sign-in requests matter here.
  const signInPaths = () => backend.requests.map((request) => new URL(request.url).pathname).filter((path) => !path.endsWith("/get-session"));
  const lastBodyFor = (path: string) => backend.requests.findLast((request) => request.url.endsWith(path))?.body;

  beforeEach(() => {
    backend = createFakeBackend();
    secureStore = createMemorySecureStore();
    deepLinkState.url = null;
  });

  it("new user: ticks 17+, enters email, enters the 6-digit code, lands signed in; sign-out and restart show sign-in", async () => {
    const screen = await startApp();
    expect(screen.text()).toContain("Sign in to BJJ Roll");

    await screen.pressRole("checkbox");
    await screen.changeText("Email", "new.member@example.test");
    await screen.press("Continue");
    expect(screen.text()).toContain("Enter your code");

    // The 6th digit submits on its own.
    await screen.changeText("6-digit code", "123456");
    expect(screen.text()).toContain("You are signed in");
    expect(signInPaths()).toEqual(["/api/auth/email-otp/send-verification-otp", "/api/auth/sign-in/email-otp"]);
    expect(secureStore.items.get("bjjroll_cookie")).toContain("signed-session-value");

    const restartedWhileSignedIn = await startApp();
    expect(restartedWhileSignedIn.text()).toContain("You are signed in");

    await restartedWhileSignedIn.press("Sign out");
    expect(restartedWhileSignedIn.text()).toContain("Sign in to BJJ Roll");
    expect(secureStore.items.has("bjjroll_cookie")).toBe(false);
    expect(secureStore.items.has("bjjroll_session_data")).toBe(false);

    const restartedAfterSignOut = await startApp();
    expect(restartedAfterSignOut.text()).toContain("Sign in to BJJ Roll");
  });

  it("magic link: requests a bjjroll://auth link, then opening the link signs the user in", async () => {
    const screen = await startApp();
    await screen.pressRole("checkbox");
    await screen.changeText("Email", "member@example.test");
    await screen.press("Email me a sign-in link instead");

    expect(screen.text()).toContain("We sent a sign-in link to member@example.test. Open it on this phone.");
    expect(lastBodyFor("/sign-in/magic-link")).toEqual({ email: "member@example.test", callbackURL: "bjjroll://auth", ageConfirmed: true });

    deepLinkState.url = "bjjroll://auth?code=one-time-exchange-code";
    await screen.rerender();

    expect(lastBodyFor("/magic-link/exchange")).toEqual({ code: "one-time-exchange-code" });
    expect(screen.text()).toContain("You are signed in");
    expect(secureStore.items.get("bjjroll_cookie")).toContain("signed-session-value");
  });

  it("an expired magic link keeps the user signed out and shows an announced error card above the title, cleared by the next action", async () => {
    deepLinkState.url = "bjjroll://auth?error=EXPIRED_TOKEN";
    const screen = await startApp();
    const message = "This sign-in link is invalid or has expired. Request a new one.";

    const [scrollView] = screen.findAllByType("ScrollView");
    const screenText = textOf(scrollView ?? "");
    expect(screenText.indexOf(message)).toBeGreaterThanOrEqual(0);
    expect(screenText.indexOf(message)).toBeLessThan(screenText.indexOf("Sign in to BJJ Roll"));
    expect(screen.queryByText(message)?.props).toMatchObject({ accessibilityLiveRegion: "polite", accessibilityRole: "alert" });
    expect(signInPaths()).toEqual([]);

    await screen.pressRole("checkbox");
    expect(screen.text()).not.toContain(message);
  });

  it("shows a labelled lime spinner on the dark background while the session loads, with light status bar icons", async () => {
    backend.fetchImplementation.mockImplementation(() => new Promise<Response>(() => undefined));
    const screen = await startApp();

    expect(screen.text()).toContain("Loading");
    const [spinner] = screen.findAllByType("ActivityIndicator");
    expect(spinner?.props.color).toBe(colours.primary);
    expect(screen.findAllByType("StatusBar")[0]?.props).toMatchObject({ barStyle: "light-content", backgroundColor: colours.background });
    expect(flattenStyle(screen.findAllByType("View")[0]?.props.style).backgroundColor).toBe(colours.background);
  });

  it("wraps the whole app in one SafeAreaProvider so every screen gets real insets", async () => {
    backend.fetchImplementation.mockImplementation(() => new Promise<Response>(() => undefined));
    const screen = await startApp();

    const [provider, ...extra] = screen.findAllByType("SafeAreaProvider");
    expect(extra).toHaveLength(0);
    expect(textOf(provider as HostNode)).toContain("Loading");
    expect(screen.findAllByType("SafeAreaContextView")).toHaveLength(1);
  });
});
