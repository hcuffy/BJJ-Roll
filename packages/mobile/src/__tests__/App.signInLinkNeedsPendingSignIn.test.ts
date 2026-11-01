import { SIGN_UP_ATTESTATION_LABEL } from "@bjj-roll/shared";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMobileAuthClient, type MobileAuthClient } from "../auth/authClient";
import {
  createFakeBackend,
  createMemorySecureStore,
  PENDING_SIGN_IN_KEY,
  seedPendingSignIn,
  TEST_BACKEND_URL,
  TEST_SIGN_IN_VERIFIER,
} from "./authTestDoubles";
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

const SIGN_IN_SCREEN = "Sign in to BJJ Roll";
const SIGNED_IN_SCREEN = "You are signed in";
const MAGIC_LINK = "bjjroll://auth?code=exchange-code-1";

describe("App opens a sign-in link only for a sign-in this phone started (A1, M1, A5)", () => {
  let backend: ReturnType<typeof createFakeBackend>;
  let secureStore: ReturnType<typeof createMemorySecureStore>;
  let rendered: string[];

  const startApp = async () => {
    appClient.store = secureStore;
    appClient.current = createMobileAuthClient({
      backendUrl: TEST_BACKEND_URL,
      storage: secureStore,
      fetchImplementation: backend.fetchImplementation,
    });
    const screen = await renderScreen(createElement(App), (text) => rendered.push(text));
    await settle();
    return screen;
  };
  const signInWithCode = async (screen: Awaited<ReturnType<typeof startApp>>) => {
    await screen.pressRole("checkbox");
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    await screen.changeText("Email", "member@example.test");
    await screen.press("Continue with email");
    await screen.changeText("6-digit code", "123456");
    expect(screen.text()).toContain(SIGNED_IN_SCREEN);
  };
  const exchanges = () => backend.requests.filter((request) => request.url.endsWith("/magic-link/exchange"));

  beforeEach(() => {
    backend = createFakeBackend();
    secureStore = createMemorySecureStore();
    rendered = [];
    deepLinkState.url = null;
  });

  it("a link with no sign-in started on this phone is not exchanged: the sign-in screen stays", async () => {
    deepLinkState.url = MAGIC_LINK;

    const screen = await startApp();

    expect(screen.text()).toContain(SIGN_IN_SCREEN);
    expect(exchanges()).toEqual([]);
    expect(secureStore.items.has("bjjroll_cookie")).toBe(false);
  });

  it("a link for a sign-in started on this phone sends its verifier, signs in, and cannot be used again", async () => {
    seedPendingSignIn(secureStore);
    deepLinkState.url = MAGIC_LINK;

    const screen = await startApp();

    expect(screen.text()).toContain(SIGNED_IN_SCREEN);
    expect(exchanges().map((request) => request.body)).toEqual([{ code: "exchange-code-1", verifier: TEST_SIGN_IN_VERIFIER }]);
    expect(secureStore.items.has(PENDING_SIGN_IN_KEY)).toBe(false);
  });

  it("a link opened while signed in is ignored", async () => {
    const screen = await startApp();
    await signInWithCode(screen);
    seedPendingSignIn(secureStore);

    deepLinkState.url = MAGIC_LINK;
    await screen.rerender();
    await settle();

    expect(screen.text()).toContain(SIGNED_IN_SCREEN);
    expect(exchanges()).toEqual([]);
  });

  it("an exchange that finishes while signing out leaves the sign-in screen and never shows signed in", async () => {
    let finishExchange: () => void = () => undefined;
    const exchangeHeld = new Promise<void>((resolve) => {
      finishExchange = resolve;
    });
    const answer = backend.fetchImplementation.getMockImplementation();
    backend.fetchImplementation.mockImplementation(async (input, init) => {
      if (new Request(input).url.endsWith("/magic-link/exchange")) {
        await exchangeHeld;
        init?.signal?.throwIfAborted();
      }
      return await (answer ?? fetch)(input, init);
    });
    const screen = await startApp();
    seedPendingSignIn(secureStore);
    deepLinkState.url = MAGIC_LINK;
    await screen.rerender();
    await signInWithCode(screen);

    let releaseKeys: () => void = () => undefined;
    secureStore.deleteItemAsync.mockImplementationOnce(
      (key: string) =>
        new Promise((resolve) => {
          releaseKeys = () => {
            secureStore.items.delete(key);
            resolve();
          };
        }),
    );
    await screen.press("Sign out");
    const rendersAfterSignOut = rendered.length;
    finishExchange();
    await settle();
    releaseKeys();
    await settle();

    expect(screen.text()).toContain(SIGN_IN_SCREEN);
    expect(rendered.slice(rendersAfterSignOut).some((text) => text.includes(SIGNED_IN_SCREEN))).toBe(false);
    expect(secureStore.items.has("bjjroll_cookie")).toBe(false);
  });
});
