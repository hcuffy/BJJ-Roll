import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMobileAuthClient, type MobileAuthClient } from "../auth/authClient";
import { failureMessages } from "../auth/signInActions";
import { colours } from "../theme/tokens";
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

describe("a refused sign-in link shows its own refusal, never the invalid-link copy (Sara)", () => {
  let backend: ReturnType<typeof createFakeBackend>;

  beforeEach(() => {
    backend = createFakeBackend();
    deepLinkState.url = null;
  });

  it.each([
    { url: "bjjroll://auth?r=age_refused", cardText: "You must be 16 or older to sign up.", absent: "Tick" },
    {
      url: "bjjroll://auth?r=attestation_refused",
      cardText: "Tick I accept these duties and send a new link.",
      absent: "Tick the box to accept the duties.",
    },
  ])("$url shows exactly '$cardText' in the red card", async ({ url, cardText, absent }) => {
    const secureStore = createMemorySecureStore();
    appClient.store = secureStore;
    appClient.current = createMobileAuthClient({
      backendUrl: TEST_BACKEND_URL,
      storage: secureStore,
      fetchImplementation: backend.fetchImplementation,
    });
    deepLinkState.url = url;

    const screen = await renderScreen(createElement(App));
    await settle();

    const card = screen.findAllByType("View").find((view) => flattenStyle(view.props.style).borderColor === colours.danger);
    expect(textOf(card as never)).toBe(cardText);
    expect(screen.queryByText(cardText)?.props).toMatchObject({ accessibilityRole: "alert" });
    expect(screen.text()).not.toContain(failureMessages.invalidLink);
    expect(screen.text()).not.toContain(absent);
    expect(screen.text()).toContain("Sign in to BJJ Roll");
    expect(backend.requests.filter((request) => request.url.endsWith("/magic-link/exchange"))).toEqual([]);
  });
});
