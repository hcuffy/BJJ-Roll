import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMobileAuthClient, type MobileAuthClient } from "../auth/authClient";
import { FAILURE_MESSAGES } from "../auth/signInActions";
import { colours } from "../theme/tokens";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL } from "./authTestDoubles";
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
const { STARTUP_REQUEST_TIMEOUT_MS } = await import("../auth/startupTimeout");
const { SERVER_UNREACHABLE_NOTE } = await import("../screens/EmailEntryScreen");

type Screen = Awaited<ReturnType<typeof renderScreen>>;
/** How the cold-start link exchange answers: never (until the app aborts it), or refused just before the deadline. */
type ExchangeMode = "neverAnswers" | "refusedInTime";

const SIGN_IN_SCREEN = "Sign in to BJJ Roll";
const SIGN_IN_LINK = "bjjroll://auth?code=one-time-exchange-code";
const LINK_ERROR = FAILURE_MESSAGES.invalidLink;

/** HEN-303 × HEN-304 merge: a link exchange that times out is a network failure (grey note), one that is refused is #84's card. */
describe("App cold-start link: timeout vs refused link (HEN-303, HEN-304)", () => {
  let exchangeMode: ExchangeMode;

  const exchange = (init?: RequestInit): Promise<Response> =>
    new Promise((resolve, reject) => {
      if (exchangeMode === "refusedInTime") {
        setTimeout(() => resolve(Response.json({ code: "INVALID_TOKEN", message: "Invalid" }, { status: 400 })), STARTUP_REQUEST_TIMEOUT_MS - 1);
        return;
      }
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    });

  const coldStartWithLink = async () => {
    const backend = createFakeBackend();
    appClient.store = createMemorySecureStore();
    appClient.current = createMobileAuthClient({
      backendUrl: TEST_BACKEND_URL,
      storage: appClient.store,
      fetchImplementation: vi.fn((input: string | URL | Request, init?: RequestInit) =>
        new Request(input, init).url.endsWith("/magic-link/exchange") ? exchange(init) : backend.fetchImplementation(input, init),
      ),
    });
    deepLinkState.url = SIGN_IN_LINK;
    return await renderScreen(createElement(App));
  };
  const advance = async (milliseconds: number) => {
    await vi.advanceTimersByTimeAsync(milliseconds);
    await settle();
  };
  const redTexts = (screen: Screen) => screen.findAllByType("Text").filter((text) => flattenStyle(text.props.style).color === colours.danger);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    deepLinkState.url = null;
    for (const method of ["log", "info", "warn", "error"] as const) {
      vi.spyOn(console, method).mockImplementation(() => undefined);
    }
  });
  afterEach(async () => {
    await settle();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("an exchange that never answers shows only the grey offline note after 10 s, not the link-error card", async () => {
    exchangeMode = "neverAnswers";
    const screen = await coldStartWithLink();
    await advance(STARTUP_REQUEST_TIMEOUT_MS - 1);
    expect(screen.text()).toContain("Loading");

    await advance(1);
    expect(screen.text()).toContain(SIGN_IN_SCREEN);
    const note = screen.queryByText(SERVER_UNREACHABLE_NOTE);
    expect(note?.props.accessibilityRole).toBeUndefined();
    expect(flattenStyle(note?.props.style).color).toBe(colours.textSecondary);
    expect(screen.text().split(SERVER_UNREACHABLE_NOTE)).toHaveLength(2);
    expect(screen.text()).not.toContain(LINK_ERROR);
    expect(redTexts(screen)).toEqual([]);
  });

  it("an exchange refused before the deadline shows the link-error card, not the grey note", async () => {
    exchangeMode = "refusedInTime";
    const screen = await coldStartWithLink();
    await advance(STARTUP_REQUEST_TIMEOUT_MS - 1);

    expect(screen.text()).toContain(SIGN_IN_SCREEN);
    const card = screen.queryByText(LINK_ERROR);
    expect(card?.props).toMatchObject({ accessibilityRole: "alert" });
    expect(flattenStyle(card?.props.style).color).toBe(colours.danger);
    expect(screen.text()).not.toContain(SERVER_UNREACHABLE_NOTE);

    // The deadline passing afterwards changes nothing.
    await advance(1);
    expect(screen.text().split(LINK_ERROR)).toHaveLength(2);
    expect(screen.text()).not.toContain(SERVER_UNREACHABLE_NOTE);
  });
});
