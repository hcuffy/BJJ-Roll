import { SIGN_UP_ATTESTATION_LABEL } from "@bjj-roll/shared";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMobileAuthClient, type MobileAuthClient } from "../auth/authClient";
import { failureMessages } from "../auth/signInActions";
import { colours } from "../theme/tokens";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL, seedPendingSignIn } from "./authTestDoubles";
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

const { App } = await import("../App");
const { STARTUP_REQUEST_TIMEOUT_MS } = await import("../auth/startupTimeout");
const { SERVER_UNREACHABLE_NOTE } = await import("../screens/EmailEntryScreen");

type Screen = Awaited<ReturnType<typeof renderScreen>>;

const EMAIL = "member@example.test";
const REJECTED_LINK = "bjjroll://auth?r=link_invalid";
const EXPIRED_MESSAGE = failureMessages.invalidLink;

describe("App: a link opened in the running app that times out replaces the last result (HEN-303, HEN-304)", () => {
  let backend: ReturnType<typeof createFakeBackend>;
  let exchangeHangs: boolean;
  let linkNumber: number;

  const startOnLinkSent = async () => {
    appClient.store = createMemorySecureStore();
    seedPendingSignIn(appClient.store);
    appClient.current = createMobileAuthClient({
      backendUrl: TEST_BACKEND_URL,
      storage: appClient.store,
      fetchImplementation: vi.fn((input: string | URL | Request, init?: RequestInit) =>
        exchangeHangs && new Request(input, init).url.endsWith("/magic-link/exchange")
          ? new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
            })
          : backend.fetchImplementation(input, init),
      ),
    });
    const screen = await renderScreen(createElement(App));
    await screen.pressRole("checkbox");
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    await screen.changeText("Email", EMAIL);
    await screen.press("Email me a sign-in link instead");
    expect(screen.text()).toContain("Check your email");
    return screen;
  };
  const openLink = async (screen: Screen, url: string) => {
    linkNumber += 1;
    deepLinkState.url = url.includes("?") ? `${url}&n=${linkNumber}` : `${url}?n=${linkNumber}`;
    await screen.rerender();
  };
  const openHangingLinkAndWaitOutTheDeadline = async (screen: Screen) => {
    exchangeHangs = true;
    await openLink(screen, "bjjroll://auth?code=one-time-exchange-code");
    await vi.advanceTimersByTimeAsync(STARTUP_REQUEST_TIMEOUT_MS);
    await screen.rerender();
  };
  const redTexts = (screen: Screen) => screen.findAllByType("Text").filter((text) => flattenStyle(text.props.style).color === colours.danger);
  const expectGreyNoteOnly = (screen: Screen) => {
    expect(screen.text()).toContain("Check your email");
    const note = screen.queryByText(SERVER_UNREACHABLE_NOTE);
    expect(note?.props.accessibilityRole).toBeUndefined();
    expect(flattenStyle(note?.props.style).color).toBe(colours.textSecondary);
    expect(screen.text().split(SERVER_UNREACHABLE_NOTE)).toHaveLength(2);
    expect(screen.text()).not.toContain(EXPIRED_MESSAGE);
    expect(redTexts(screen)).toEqual([]);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    backend = createFakeBackend();
    exchangeHangs = false;
    linkNumber = 0;
    deepLinkState.url = null;
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation(() => undefined);
    }
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("an old link-error card goes when the next link times out: the grey note shows alone", async () => {
    const screen = await startOnLinkSent();
    await openLink(screen, REJECTED_LINK);
    expect(screen.text()).toContain(EXPIRED_MESSAGE);

    await openHangingLinkAndWaitOutTheDeadline(screen);
    expectGreyNoteOnly(screen);
  });

  it("an old red form error goes when the next link times out: the grey note shows alone", async () => {
    const screen = await startOnLinkSent();
    await vi.advanceTimersByTimeAsync(30_000).then(() => screen.rerender());
    backend.fetchImplementation.mockResolvedValueOnce(Response.json({ message: "Refused" }, { status: 429 }));
    await screen.press("Resend link");
    expect(redTexts(screen).length).toBeGreaterThan(0);

    await openHangingLinkAndWaitOutTheDeadline(screen);
    expectGreyNoteOnly(screen);
  });
});
