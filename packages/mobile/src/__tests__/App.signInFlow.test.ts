import { SIGN_UP_ATTESTATION_LABEL, signUpAttestationVersion } from "@bjj-roll/shared";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMobileAuthClient, type MobileAuthClient } from "../auth/authClient";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL, TEST_DELETE_CODE } from "./authTestDoubles";
import { colours } from "../theme/tokens";
import { deepLinkState, flattenStyle, type HostNode, renderScreen, textOf } from "./screenHarness";

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
const DELETED_NOTICE = "Your account was deleted. If you sign up again, you get a new, empty account.";

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
  const signInPaths = () =>
    backend.requests
      .map((request) => new URL(request.url).pathname)
      .filter((path) => !path.endsWith("/get-session") && !path.startsWith("/account/"));
  const lastBodyFor = (path: string) => backend.requests.findLast((request) => request.url.endsWith(path))?.body;

  beforeEach(() => {
    backend = createFakeBackend();
    secureStore = createMemorySecureStore();
    deepLinkState.url = null;
  });

  it("new user: ticks 16+, enters email, enters the 6-digit code, lands signed in; sign-out and restart show sign-in", async () => {
    const screen = await startApp();
    expect(screen.text()).toContain("Sign in to BJJ Roll");

    await screen.pressRole("checkbox");
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    await screen.changeText("Email", "new.member@example.test");
    await screen.press("Continue with email");
    expect(screen.text()).toContain("Enter your code");

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

  it("18+ (HEN-263): the optional tick goes with the first code and with Resend code", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const screen = await startApp();
      await screen.pressRole("checkbox");
      await screen.press(SIGN_UP_ATTESTATION_LABEL);
      await screen.press("I am 18 or older");
      await screen.changeText("Email", "new.member@example.test");
      await screen.press("Continue with email");
      await vi.advanceTimersByTimeAsync(30_000);
      await screen.rerender();
      await screen.press("Resend code");

      const sends = backend.requests.filter((request) => request.url.endsWith("/send-verification-otp"));
      expect(sends.map((request) => request.body?.age18Confirmed)).toEqual([true, true]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("18+ (HEN-263): signed in without the 18+ tick, the Account section confirms it later and then says so", async () => {
    const screen = await startApp();
    await screen.pressRole("checkbox");
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    await screen.changeText("Email", "new.member@example.test");
    await screen.press("Continue with email");
    await screen.changeText("6-digit code", "123456");
    expect(screen.text()).toContain("You are signed in");

    await screen.press("Confirm I am 18 or older");
    await screen.press("Yes, I am 18 or older");
    expect(lastBodyFor("/account/age-confirmation")).toEqual({ age18Confirmed: true });
    expect(screen.text()).toContain("18 or older: confirmed");
    expect(screen.queryByText("Confirm I am 18 or older")).toBeNull();
  });

  it("delete account (HEN-65): confirm, email a code, DELETE /account with code and cookie, then signed-out, also after a restart", async () => {
    const screen = await startApp();
    await screen.pressRole("checkbox");
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    await screen.changeText("Email", "member@example.test");
    await screen.press("Continue with email");
    await screen.changeText("6-digit code", "123456");
    expect(screen.text()).toContain("You are signed in");

    await screen.press("Delete account");
    await screen.press("Email me a code");
    expect(backend.requests.filter((request) => request.method === "DELETE")).toEqual([]);
    await screen.changeText("6-digit code", TEST_DELETE_CODE);
    await screen.press("Delete my account");

    expect(screen.text()).toContain("Sign in to BJJ Roll");
    const accountRequests = backend.requests.filter((request) => new URL(request.url).pathname.startsWith("/account"));
    expect(accountRequests.map((request) => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
      "GET /account/signup-attestation",
      "GET /account/age-confirmation",
      "POST /account/delete-code",
      "DELETE /account",
    ]);
    const deleteRequests = backend.requests.filter((request) => request.method === "DELETE");
    expect(deleteRequests[0]?.body).toEqual({ code: TEST_DELETE_CODE });
    expect(deleteRequests[0]?.cookie).toContain("signed-session-value");
    expect(secureStore.items.has("bjjroll_cookie")).toBe(false);
    expect(secureStore.items.has("bjjroll_session_data")).toBe(false);

    const restarted = await startApp();
    expect(restarted.text()).toContain("Sign in to BJJ Roll");
    expect(restarted.text()).not.toContain(DELETED_NOTICE);
  });

  it("after delete (Vera item 3): the sign-in screen shows a one-time neutral, announced notice: re-signup is a new empty account", async () => {
    const screen = await startApp();
    await screen.pressRole("checkbox");
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    await screen.changeText("Email", "member@example.test");
    await screen.press("Continue with email");
    await screen.changeText("6-digit code", "123456");
    await screen.press("Delete account");
    await screen.press("Email me a code");
    await screen.changeText("6-digit code", TEST_DELETE_CODE);
    await screen.press("Delete my account");

    expect(screen.text()).toContain("Sign in to BJJ Roll");
    expect(screen.text()).toContain(DELETED_NOTICE);
    const notice = screen.queryByText(DELETED_NOTICE);
    expect(notice?.props).toMatchObject({ accessibilityRole: "alert", accessibilityLiveRegion: "polite" });
    expect(flattenStyle(notice?.props.style)).toMatchObject({ color: colours.textPrimary });
    const card = screen.findAllByType("View").find((node) => node.children.includes(notice as HostNode));
    expect(flattenStyle(card?.props.style)).toMatchObject({ backgroundColor: colours.surface, borderRadius: 16, padding: 16 });
    expect(flattenStyle(card?.props.style).borderColor).toBeUndefined();
    expect(screen.text().indexOf(DELETED_NOTICE)).toBeLessThan(screen.text().indexOf("Sign in to BJJ Roll"));

    await screen.changeText("Email", "someone@example.test");
    expect(screen.text()).not.toContain(DELETED_NOTICE);
  });

  it("magic link: requests a bjjroll://auth link, then opening the link signs the user in", async () => {
    const screen = await startApp();
    await screen.pressRole("checkbox");
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    await screen.changeText("Email", "member@example.test");
    await screen.press("Email me a sign-in link instead");

    expect(screen.text()).toContain("We sent a sign-in link to member@example.test. Open it on this phone.");
    expect(lastBodyFor("/sign-in/magic-link")).toEqual({
      email: "member@example.test",
      callbackURL: "bjjroll://auth",
      age16Confirmed: true,
      age18Confirmed: false,
      signUpAttestationTextVersionId: signUpAttestationVersion.id,
    });

    deepLinkState.url = "bjjroll://auth?code=one-time-exchange-code";
    await screen.rerender();

    expect(lastBodyFor("/magic-link/exchange")).toEqual({ code: "one-time-exchange-code" });
    expect(screen.text()).toContain("You are signed in");
    expect(secureStore.items.get("bjjroll_cookie")).toContain("signed-session-value");
  });

  it("an expired magic link keeps the user signed out and shows an announced error card above the title, cleared by the next action", async () => {
    deepLinkState.url = "bjjroll://auth?r=link_invalid";
    const screen = await startApp();
    const message = "This sign-in link has expired or was already used. Send a new one.";

    const [scrollView] = screen.findAllByType("ScrollView");
    const screenText = textOf(scrollView ?? "");
    expect(screenText.indexOf(message)).toBeGreaterThanOrEqual(0);
    expect(screenText.indexOf(message)).toBeLessThan(screenText.indexOf("Sign in to BJJ Roll"));
    expect(screen.queryByText(message)?.props).toMatchObject({ accessibilityLiveRegion: "polite", accessibilityRole: "alert" });
    expect(signInPaths()).toEqual([]);

    await screen.pressRole("checkbox");
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    expect(screen.text()).not.toContain(message);
  });

  it("a magic link refused for age (r=age_refused) shows the refusal with the next step under it", async () => {
    deepLinkState.url = "bjjroll://auth?r=age_refused";
    const screen = await startApp();

    expect(screen.text()).toContain("You must be 16 or older to sign up.");
    expect(screen.text()).toContain("Tick I am 16 or older and send a new link.");
  });

  it("shows a muted spinner and one readable 'Loading' on the dark background while the session loads, with light status bar icons", async () => {
    backend.fetchImplementation.mockImplementation(() => new Promise<Response>(() => undefined));
    const screen = await startApp();

    expect(screen.text()).toContain("Loading");
    const [spinner] = screen.findAllByType("ActivityIndicator");
    expect(spinner?.props.color).toBe(colours.textSecondary);
    expect(spinner?.props).toMatchObject({ accessibilityElementsHidden: true, importantForAccessibility: "no" });
    expect(spinner?.props.accessibilityLabel).toBeUndefined();
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
