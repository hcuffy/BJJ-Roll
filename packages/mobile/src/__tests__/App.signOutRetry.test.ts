import { inspect } from "node:util";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMobileAuthClient, type MobileAuthClient } from "../auth/authClient";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL } from "./authTestDoubles";
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

const SESSION_KEYS = ["bjjroll_cookie", "bjjroll_session_data"];
const SIGN_IN_SCREEN = "Sign in to BJJ Roll";
const SIGNED_IN_SCREEN = "You are signed in";

describe("App finishes a failed sign-out on the next launch (HEN-286)", () => {
  let backend: ReturnType<typeof createFakeBackend>;
  // One phone: the same SecureStore survives every launch in a test.
  let secureStore: ReturnType<typeof createMemorySecureStore>;
  let serverDown: boolean;
  let signOutEndpointDown: boolean;
  let signOutEndpointErrors: boolean;
  const unhandledRejections: unknown[] = [];
  const recordUnhandled = (reason: unknown) => unhandledRejections.push(reason);
  /** Text of every screen rendered since the last launch. */
  let renderedScreens: string[] = [];
  let consoleSpies: { readonly mock: { readonly calls: readonly (readonly unknown[])[] } }[] = [];

  /** A fresh app process on the same phone: new auth client, same SecureStore. */
  const launchApp = async () => {
    appClient.store = secureStore;
    appClient.current = createMobileAuthClient({
      backendUrl: TEST_BACKEND_URL,
      storage: secureStore,
      fetchImplementation: vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const signingOut = new Request(input, init).url.endsWith("/sign-out");
        if (signingOut && signOutEndpointErrors) {
          return Promise.resolve(new Response(JSON.stringify({ message: "Internal Server Error" }), { status: 500 }));
        }
        return serverDown || (signingOut && signOutEndpointDown)
          ? Promise.reject(new TypeError("fetch failed"))
          : backend.fetchImplementation(input, init);
      }),
    });
    renderedScreens = [];
    return await renderScreen(createElement(App), (text) => renderedScreens.push(text));
  };
  const signIn = async (screen: Awaited<ReturnType<typeof launchApp>>) => {
    await screen.pressRole("checkbox");
    await screen.changeText("Email", "member@example.test");
    await screen.press("Continue");
    await screen.changeText("6-digit code", "123456");
    expect(screen.text()).toContain(SIGNED_IN_SCREEN);
  };
  const breakSessionKeys = () => SESSION_KEYS.forEach((key) => secureStore.failingKeys.add(key));
  const repairSecureStore = () => secureStore.failingKeys.clear();
  const signOutRequestCount = () => backend.requests.filter((request) => request.url.endsWith("/sign-out")).length;

  /** Signed in, then sign-out fails everywhere: SecureStore cannot remove the session and the server cannot be reached. */
  const failedSignOut = async () => {
    const screen = await launchApp();
    await signIn(screen);
    breakSessionKeys();
    serverDown = true;
    await screen.press("Sign out");
    expect(screen.text()).toContain(SIGN_IN_SCREEN);
  };

  beforeEach(() => {
    backend = createFakeBackend();
    secureStore = createMemorySecureStore();
    serverDown = false;
    signOutEndpointDown = false;
    signOutEndpointErrors = false;
    deepLinkState.url = null;
    unhandledRejections.length = 0;
    process.on("unhandledRejection", recordUnhandled);
    // Silenced but recorded: Better Auth logs its own SecureStore errors; they must not carry the session or the email.
    consoleSpies = (["log", "info", "warn", "error"] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => undefined));
  });
  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.off("unhandledRejection", recordUnhandled);
    expect(unhandledRejections).toEqual([]);
    const logged = consoleSpies
      .flatMap((spy) => spy.mock.calls.flat<readonly (readonly unknown[])[]>())
      .map((value) => inspect(value, { depth: 8 }))
      .join("\n");
    for (const secret of ["signed-session-value", "raw-session-token", "member@example.test"]) {
      expect(logged).not.toContain(secret);
    }
    vi.restoreAllMocks();
  });

  it("next launch: stays signed out although the session is still on the phone and the retry fails again", async () => {
    await failedSignOut();

    // Server answers again, except sign-out, and SecureStore still cannot delete: the stale session would be valid.
    serverDown = false;
    signOutEndpointDown = true;
    const nextLaunch = await launchApp();

    expect(nextLaunch.text()).toContain(SIGN_IN_SCREEN);
    expect(nextLaunch.text()).not.toContain(SIGNED_IN_SCREEN);
  });

  it("keeps retrying on every launch until both steps succeed, then a new sign-in sticks", async () => {
    await failedSignOut();
    serverDown = false;
    signOutEndpointDown = true;

    expect((await launchApp()).text()).toContain(SIGN_IN_SCREEN);
    expect((await launchApp()).text()).toContain(SIGN_IN_SCREEN);

    // Phone and server healthy again: this launch finishes the sign-out.
    repairSecureStore();
    signOutEndpointDown = false;
    const healedLaunch = await launchApp();
    expect(healedLaunch.text()).toContain(SIGN_IN_SCREEN);
    expect(secureStore.items.get("bjjroll_cookie") ?? "").not.toContain("signed-session-value");

    // The finished sign-out is not repeated: the user signs in again and stays signed in on the next launch.
    await signIn(healedLaunch);
    expect((await launchApp()).text()).toContain(SIGNED_IN_SCREEN);
  });

  it("session removed from the phone but the server was not told: the next launch tells the server", async () => {
    const screen = await launchApp();
    await signIn(screen);
    serverDown = true;
    await screen.press("Sign out");
    expect(screen.text()).toContain(SIGN_IN_SCREEN);
    const signOutsBefore = signOutRequestCount();

    serverDown = false;
    const nextLaunch = await launchApp();

    expect(nextLaunch.text()).toContain(SIGN_IN_SCREEN);
    expect(signOutRequestCount()).toBe(signOutsBefore + 1);
    // Done now: the launch after that does not sign out again.
    expect((await launchApp()).text()).toContain(SIGN_IN_SCREEN);
    expect(signOutRequestCount()).toBe(signOutsBefore + 1);
  });

  it("a server error on sign-out counts as not done: the next launch tells the server again", async () => {
    const screen = await launchApp();
    await signIn(screen);
    signOutEndpointErrors = true;
    await screen.press("Sign out");
    expect(screen.text()).toContain(SIGN_IN_SCREEN);
    const signOutsBefore = signOutRequestCount();

    signOutEndpointErrors = false;
    expect((await launchApp()).text()).toContain(SIGN_IN_SCREEN);
    expect(signOutRequestCount()).toBe(signOutsBefore + 1);
  });

  it("sign-out still ends the session when the pending-sign-out marker cannot be saved", async () => {
    const screen = await launchApp();
    await signIn(screen);
    secureStore.failingKeys.add("bjjroll_pending_sign_out");

    await screen.press("Sign out");
    expect(screen.text()).toContain(SIGN_IN_SCREEN);

    expect((await launchApp()).text()).toContain(SIGN_IN_SCREEN);
  });

  it("a successful sign-out leaves nothing to finish: the next sign-in survives a restart", async () => {
    const screen = await launchApp();
    await signIn(screen);
    await screen.press("Sign out");
    expect(screen.text()).toContain(SIGN_IN_SCREEN);

    const nextLaunch = await launchApp();
    expect(nextLaunch.text()).toContain(SIGN_IN_SCREEN);
    await signIn(nextLaunch);
    expect((await launchApp()).text()).toContain(SIGNED_IN_SCREEN);
  });

  describe("signing in again cancels the unfinished sign-out (Henry, 2026-10-26)", () => {
    /** Signed in, then sign-out cannot reach the server: the session is gone from the phone, the sign-out is left to finish. */
    const signOutLeftUnfinished = async () => {
      const screen = await launchApp();
      await signIn(screen);
      signOutEndpointDown = true;
      await screen.press("Sign out");
      expect(screen.text()).toContain(SIGN_IN_SCREEN);
      signOutEndpointDown = false;
      return screen;
    };

    it("with the emailed code: the user is still signed in after a restart", async () => {
      const screen = await signOutLeftUnfinished();
      await signIn(screen);
      const signOutsBefore = signOutRequestCount();

      const nextLaunch = await launchApp();

      expect(nextLaunch.text()).toContain(SIGNED_IN_SCREEN);
      expect(signOutRequestCount()).toBe(signOutsBefore);
    });

    it("with a magic link: the user is still signed in after a restart", async () => {
      const screen = await signOutLeftUnfinished();
      deepLinkState.url = "bjjroll://auth?code=one-time-exchange-code";
      await screen.rerender();
      expect(screen.text()).toContain(SIGNED_IN_SCREEN);
      deepLinkState.url = null;
      const signOutsBefore = signOutRequestCount();

      const nextLaunch = await launchApp();

      expect(nextLaunch.text()).toContain(SIGNED_IN_SCREEN);
      expect(signOutRequestCount()).toBe(signOutsBefore);
    });

    it("cold start from a sign-in link: the link waits for the unfinished sign-out, then the user stays signed in", async () => {
      await signOutLeftUnfinished();

      // The app is closed; the user opens a sign-in link, which starts the app.
      deepLinkState.url = "bjjroll://auth?code=one-time-exchange-code";
      const coldStart = await launchApp();
      deepLinkState.url = null;

      expect(coldStart.text()).toContain(SIGNED_IN_SCREEN);
      const signInAt = backend.requests.findLastIndex((request) => request.url.endsWith("/magic-link/exchange"));
      expect(signInAt).toBeGreaterThanOrEqual(0);
      expect(backend.requests.slice(signInAt).filter((request) => request.url.endsWith("/sign-out"))).toEqual([]);
      expect((await launchApp()).text()).toContain(SIGNED_IN_SCREEN);
    });

    /** Screens shown from launch until the first "You are signed in". */
    const screensBeforeSignedIn = () =>
      renderedScreens.slice(
        0,
        renderedScreens.findIndex((text) => text.includes(SIGNED_IN_SCREEN)),
      );

    it("cold start from a sign-in link with a pending sign-out: Loading until signed in, never the sign-in screen", async () => {
      await signOutLeftUnfinished();

      deepLinkState.url = "bjjroll://auth?code=one-time-exchange-code";
      const coldStart = await launchApp();
      deepLinkState.url = null;

      expect(coldStart.text()).toContain(SIGNED_IN_SCREEN);
      expect(screensBeforeSignedIn().length).toBeGreaterThan(0);
      expect(screensBeforeSignedIn().filter((text) => text.includes(SIGN_IN_SCREEN))).toEqual([]);
      expect(screensBeforeSignedIn().every((text) => text.includes("Loading"))).toBe(true);
    });

    it("cold start from a sign-in link with nothing pending: Loading until signed in, never the sign-in screen", async () => {
      deepLinkState.url = "bjjroll://auth?code=one-time-exchange-code";
      const coldStart = await launchApp();
      deepLinkState.url = null;

      expect(coldStart.text()).toContain(SIGNED_IN_SCREEN);
      expect(screensBeforeSignedIn().length).toBeGreaterThan(0);
      expect(screensBeforeSignedIn().filter((text) => text.includes(SIGN_IN_SCREEN))).toEqual([]);
      expect(screensBeforeSignedIn().every((text) => text.includes("Loading"))).toBe(true);
    });

    it("cold start from a link that is not a sign-in link: leaves Loading for the sign-in screen", async () => {
      deepLinkState.url = "bjjroll://other";
      const coldStart = await launchApp();
      deepLinkState.url = null;

      expect(coldStart.text()).toContain(SIGN_IN_SCREEN);
      expect(coldStart.text()).not.toContain("Loading");
    });

    it("sign-in is not blocked when the unfinished sign-out cannot be cancelled", async () => {
      const screen = await signOutLeftUnfinished();
      secureStore.failingKeys.add("bjjroll_pending_sign_out");

      await signIn(screen);

      expect(screen.text()).toContain(SIGNED_IN_SCREEN);
    });
  });
});
