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
const NOT_STARTED_NOTE = "This sign-in link wasn't started on this phone. Enter your email below to get a new one.";
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
});
