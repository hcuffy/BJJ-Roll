import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMobileAuthClient, type MobileAuthClient } from "../auth/authClient";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL } from "./authTestDoubles";
import { deepLinkState, renderScreen } from "./screenHarness";

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

    await screen.changeText("6-digit code", "123456");
    await screen.press("Sign in");
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

    expect(screen.text()).toContain("Check your email and open the link on this phone.");
    expect(lastBodyFor("/sign-in/magic-link")).toEqual({ email: "member@example.test", callbackURL: "bjjroll://auth", ageConfirmed: true });

    deepLinkState.url = "bjjroll://auth?code=one-time-exchange-code";
    await screen.rerender();

    expect(lastBodyFor("/magic-link/exchange")).toEqual({ code: "one-time-exchange-code" });
    expect(screen.text()).toContain("You are signed in");
    expect(secureStore.items.get("bjjroll_cookie")).toContain("signed-session-value");
  });

  it("an expired magic link keeps the user signed out and says so", async () => {
    deepLinkState.url = "bjjroll://auth?error=EXPIRED_TOKEN";
    const screen = await startApp();

    expect(screen.text()).toContain("This sign-in link is invalid or has expired. Request a new one.");
    expect(signInPaths()).toEqual([]);
  });
});
