import { SIGN_UP_ATTESTATION_LABEL } from "@bjj-roll/shared";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMobileAuthClient, type MobileAuthClient } from "../auth/authClient";
import { colours } from "../theme/tokens";
import { createFakeBackend, createMemorySecureStore, seedPendingSignIn, TEST_BACKEND_URL } from "./authTestDoubles";
import { deepLinkState, flattenStyle, renderScreen, settle } from "./screenHarness";

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

type Screen = Awaited<ReturnType<typeof renderScreen>>;

const SIGN_IN_SCREEN = "Sign in to BJJ Roll";
const SIGNED_IN_SCREEN = "You are signed in";
const EXPIRED_MESSAGE = "This sign-in link has expired, was already used, or was requested on another phone. Send a new one from this phone.";
const NOT_STARTED_NOTE = "This sign-in link can't be used on this phone. Enter your email below to get a new one.";
const CODE_SCREEN_EXPIRED =
  "This sign-in link has expired, was already used, or was requested on another phone. Enter the code from your email, or send a new one.";
const CODE_SCREEN_NOT_STARTED = "This sign-in link can't be used on this phone. Enter the code from your email, or send a new one.";
const WRONG_CODE = "That code didn't work. Check the email or send a new code.";
const REJECTED_LINK = "bjjroll://auth?r=link_invalid";
const CODE_LINK = "bjjroll://auth?code=exchange-code-1";

describe("App reads a sign-in link before it asks for a sign-in started on this phone (Vera fixes 1, 2, 7)", () => {
  let backend: ReturnType<typeof createFakeBackend>;
  let secureStore: ReturnType<typeof createMemorySecureStore>;

  const startApp = async () => {
    appClient.store = secureStore;
    appClient.current = createMobileAuthClient({
      backendUrl: TEST_BACKEND_URL,
      storage: secureStore,
      fetchImplementation: backend.fetchImplementation,
    });
    const screen = await renderScreen(createElement(App));
    await settle();
    return screen;
  };
  const openLink = async (screen: Screen, url: string) => {
    deepLinkState.url = url;
    await screen.rerender();
    await settle();
  };
  const exchanges = () => backend.requests.filter((request) => request.url.endsWith("/magic-link/exchange"));
  const redTexts = (screen: Screen) => screen.findAllByType("Text").filter((text) => flattenStyle(text.props.style).color === colours.danger);

  const startOnCodeScreen = async () => {
    const screen = await startApp();
    await screen.pressRole("checkbox");
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    await screen.changeText("Email", "member@example.test");
    await screen.press("Continue with email");
    expect(screen.text()).toContain("Enter your code");
    return screen;
  };
  const expectRedCard = (screen: Screen, message: string) => {
    const card = screen.queryByText(message);
    expect(card?.props).toMatchObject({ accessibilityRole: "alert", accessibilityLiveRegion: "polite" });
    expect(flattenStyle(card?.props.style).color).toBe(colours.danger);
  };

  const expectGreyNote = (screen: Screen, message: string) => {
    const note = screen.queryByText(message);
    expect(note?.props).toMatchObject({ accessibilityLiveRegion: "polite" });
    expect(note?.props.accessibilityRole).toBeUndefined();
    expect(flattenStyle(note?.props.style).color).toBe(colours.textSecondary);
    expect(redTexts(screen)).toEqual([]);
  };

  beforeEach(() => {
    backend = createFakeBackend();
    secureStore = createMemorySecureStore();
    deepLinkState.url = null;
  });

  it("an expired or used link with nothing pending shows the red card on the email screen and exchanges nothing", async () => {
    deepLinkState.url = REJECTED_LINK;

    const screen = await startApp();

    const card = screen.queryByText(EXPIRED_MESSAGE);
    expect(card?.props).toMatchObject({ accessibilityRole: "alert", accessibilityLiveRegion: "polite" });
    expect(flattenStyle(card?.props.style).color).toBe(colours.danger);
    expect(screen.text()).toContain(SIGN_IN_SCREEN);
    expect(exchanges()).toEqual([]);
  });

  it("a code link with nothing pending shows the calm grey note and never exchanges the code", async () => {
    deepLinkState.url = CODE_LINK;

    const screen = await startApp();

    const note = screen.queryByText(NOT_STARTED_NOTE);
    expect(note?.props).toMatchObject({ accessibilityLiveRegion: "polite" });
    expect(note?.props.accessibilityRole).toBeUndefined();
    expect(flattenStyle(note?.props.style).color).toBe(colours.textSecondary);
    expect(redTexts(screen)).toEqual([]);
    expect(screen.text()).toContain(SIGN_IN_SCREEN);
    expect(exchanges()).toEqual([]);
    expect(backend.fetchImplementation).not.toHaveBeenCalledWith(expect.stringContaining("/magic-link/exchange"), expect.anything());
    expect(secureStore.items.has("bjjroll_cookie")).toBe(false);
  });

  it("a double tap: an error link during the exchange is dropped, the first link signs in, and no card shows after a later sign-out", async () => {
    let finishExchange: () => void = () => undefined;
    const exchangeHeld = new Promise<void>((resolve) => {
      finishExchange = resolve;
    });
    const answer = backend.fetchImplementation.getMockImplementation();
    backend.fetchImplementation.mockImplementation(async (input, init) => {
      if (new Request(input).url.endsWith("/magic-link/exchange")) {
        await exchangeHeld;
      }
      return await (answer ?? fetch)(input, init);
    });
    const screen = await startApp();
    await screen.pressRole("checkbox");
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    seedPendingSignIn(secureStore);

    await openLink(screen, CODE_LINK);
    await openLink(screen, REJECTED_LINK);
    expect(redTexts(screen)).toEqual([]);
    finishExchange();
    await settle();
    expect(screen.text()).toContain(SIGNED_IN_SCREEN);

    await screen.press("Sign out");
    await settle();

    expect(screen.text()).toContain(SIGN_IN_SCREEN);
    expect(screen.text()).not.toContain(EXPIRED_MESSAGE);
    expect(redTexts(screen)).toEqual([]);
    expect(exchanges()).toHaveLength(1);
  });

  it("after sign-out, a link that was already used shows the red card and exchanges nothing more", async () => {
    const screen = await startApp();
    await screen.pressRole("checkbox");
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    seedPendingSignIn(secureStore);
    await openLink(screen, CODE_LINK);
    expect(screen.text()).toContain(SIGNED_IN_SCREEN);
    await screen.press("Sign out");
    await settle();
    const exchangesBeforeOldLink = exchanges().length;

    await openLink(screen, REJECTED_LINK);

    expectRedCard(screen, EXPIRED_MESSAGE);
    expect(screen.text()).not.toContain(NOT_STARTED_NOTE);
    expect(screen.text()).toContain(SIGN_IN_SCREEN);
    expect(exchanges()).toHaveLength(exchangesBeforeOldLink);
  });

  it("after sign-out, an older link that was never used shows the grey note and is never exchanged", async () => {
    const screen = await startOnCodeScreen();
    seedPendingSignIn(secureStore);
    await screen.changeText("6-digit code", "123456");
    await settle();
    expect(screen.text()).toContain(SIGNED_IN_SCREEN);
    await screen.press("Sign out");
    await settle();

    await openLink(screen, CODE_LINK);

    expectGreyNote(screen, NOT_STARTED_NOTE);
    expect(screen.text()).not.toContain(EXPIRED_MESSAGE);
    expect(screen.text()).toContain(SIGN_IN_SCREEN);
    expect(exchanges()).toEqual([]);
  });

  it("an expired or used link on the code screen shows the code screen copy", async () => {
    const screen = await startOnCodeScreen();

    await openLink(screen, REJECTED_LINK);

    expectRedCard(screen, CODE_SCREEN_EXPIRED);
    expect(exchanges()).toEqual([]);
  });

  it("an error link that arrives during an email-code sign-in still shows its card", async () => {
    let finishCodeSignIn: () => void = () => undefined;
    const codeSignInHeld = new Promise<void>((resolve) => {
      finishCodeSignIn = resolve;
    });
    const answer = backend.fetchImplementation.getMockImplementation();
    backend.fetchImplementation.mockImplementation(async (input, init) => {
      if (new Request(input).url.endsWith("/sign-in/email-otp")) {
        await codeSignInHeld;
      }
      return await (answer ?? fetch)(input, init);
    });
    const screen = await startOnCodeScreen();
    await screen.changeText("6-digit code", "123456");

    await openLink(screen, REJECTED_LINK);

    expectRedCard(screen, CODE_SCREEN_EXPIRED);
    finishCodeSignIn();
    await settle();
    expect(screen.text()).toContain(SIGNED_IN_SCREEN);
  });

  it("a code link with nothing pending on the code screen shows the code screen grey note and never exchanges the code", async () => {
    const screen = await startOnCodeScreen();

    await openLink(screen, CODE_LINK);

    expectGreyNote(screen, CODE_SCREEN_NOT_STARTED);
    expect(screen.text()).not.toContain(NOT_STARTED_NOTE);
    expect(screen.text()).toContain("Enter your code");
    expect(exchanges()).toEqual([]);
  });

  it("typing a code clears the grey note", async () => {
    const screen = await startOnCodeScreen();
    await openLink(screen, CODE_LINK);
    expectGreyNote(screen, CODE_SCREEN_NOT_STARTED);

    await screen.changeText("6-digit code", "1");

    expect(screen.text()).not.toContain(CODE_SCREEN_NOT_STARTED);
  });

  it("submitting a wrong code clears the grey note so the code error shows", async () => {
    backend = createFakeBackend({ emailOtpRefusal: { status: 400, body: { code: "INVALID_OTP", message: "Invalid OTP" } } });
    const screen = await startOnCodeScreen();
    await openLink(screen, CODE_LINK);
    expectGreyNote(screen, CODE_SCREEN_NOT_STARTED);

    await screen.changeText("6-digit code", "123456");
    await settle();

    expect(screen.text()).not.toContain(CODE_SCREEN_NOT_STARTED);
    expect(redTexts(screen).map((text) => text.props.children)).toContain(WRONG_CODE);
  });
});
