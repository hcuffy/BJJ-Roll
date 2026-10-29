import { SIGN_UP_ATTESTATION_LABEL } from "@bjj-roll/shared";
import { createElement } from "react";
import { AccessibilityInfo, Platform } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMobileAuthClient, type MobileAuthClient } from "../auth/authClient";
import { FAILURE_MESSAGES } from "../auth/signInActions";
import { colours } from "../theme/tokens";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL } from "./authTestDoubles";
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
const { SERVER_UNREACHABLE_NOTE } = await import("../screens/EmailEntryScreen");

type Screen = Awaited<ReturnType<typeof renderScreen>>;

const EMAIL = "member@example.test";
const LINK_CODE = "one-time-exchange-code";
const REJECTED_LINK = "bjjroll://auth?r=link_invalid";
const EXPIRED_MESSAGE = FAILURE_MESSAGES.invalidLink;

/** HEN-304: a sign-in link that fails while the app is on "Check your email" or the code screen gives feedback on that view. */
describe("App when a sign-in link fails after a send (HEN-304)", () => {
  let backend: ReturnType<typeof createFakeBackend>;
  // Request paths that fail on the network, as React Native's fetch does when the host is unreachable.
  let unreachablePaths: Set<string>;
  let linkNumber: number;
  const consoleCalls: unknown[][] = [];

  const startApp = async () => {
    appClient.store = createMemorySecureStore();
    appClient.current = createMobileAuthClient({
      backendUrl: TEST_BACKEND_URL,
      storage: appClient.store,
      fetchImplementation: vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const path = new URL(new Request(input, init).url).pathname;
        return [...unreachablePaths].some((unreachable) => path.endsWith(unreachable))
          ? Promise.reject(new TypeError("Network request failed"))
          : backend.fetchImplementation(input, init);
      }),
    });
    const screen = await renderScreen(createElement(App));
    await screen.pressRole("checkbox");
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    await screen.changeText("Email", EMAIL);
    return screen;
  };
  const startOnLinkSent = async () => {
    const screen = await startApp();
    await screen.press("Email me a sign-in link instead");
    expect(screen.text()).toContain("Check your email");
    return screen;
  };
  const startOnCodeScreen = async () => {
    const screen = await startApp();
    await screen.press("Continue with email");
    expect(screen.text()).toContain("Enter your code");
    return screen;
  };
  /** The user taps a sign-in link from the email while the app is running; each link is a new one. */
  const openLink = async (screen: Screen, url: string) => {
    linkNumber += 1;
    deepLinkState.url = url.includes("?") ? `${url}&n=${linkNumber}` : `${url}?n=${linkNumber}`;
    await screen.rerender();
  };
  const openNetworkFailingLink = async (screen: Screen) => {
    unreachablePaths.add("/magic-link/exchange");
    await openLink(screen, `bjjroll://auth?code=${LINK_CODE}`);
  };
  const redTexts = (screen: Screen) => screen.findAllByType("Text").filter((text) => flattenStyle(text.props.style).color === colours.danger);
  const expectLinkErrorCardBetween = (screen: Screen, above: string, below: string) => {
    const card = screen.queryByText(EXPIRED_MESSAGE);
    expect(card?.props).toMatchObject({ accessibilityRole: "alert", accessibilityLiveRegion: "polite" });
    expect(flattenStyle(card?.props.style).color).toBe(colours.danger);
    // The red error slot of the view: under its content, above its buttons.
    const text = screen.text();
    expect(text.indexOf(EXPIRED_MESSAGE)).toBeGreaterThan(text.indexOf(above));
    expect(text.indexOf(EXPIRED_MESSAGE)).toBeLessThan(text.indexOf(below));
    expect(text).not.toContain(SERVER_UNREACHABLE_NOTE);
  };
  const expectCalmNoteOnly = (screen: Screen) => {
    const note = screen.queryByText(SERVER_UNREACHABLE_NOTE);
    expect(note?.props).toMatchObject({ accessibilityLiveRegion: "polite" });
    expect(note?.props.accessibilityRole).toBeUndefined();
    expect(flattenStyle(note?.props.style).color).toBe(colours.textSecondary);
    expect(redTexts(screen)).toEqual([]);
    expect(screen.text()).not.toContain(EXPIRED_MESSAGE);
  };
  const announcementsOf = (message: string) =>
    vi.mocked(AccessibilityInfo.announceForAccessibility).mock.calls.filter(([announced]) => announced === message).length;

  beforeEach(() => {
    vi.useFakeTimers();
    backend = createFakeBackend();
    unreachablePaths = new Set();
    linkNumber = 0;
    deepLinkState.url = null;
    consoleCalls.length = 0;
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...callArguments: unknown[]) => consoleCalls.push(callArguments));
    }
    vi.mocked(AccessibilityInfo.announceForAccessibility).mockClear();
  });
  afterEach(() => {
    // No link token, code or email in logs.
    const logged = JSON.stringify(consoleCalls);
    expect(logged).not.toContain(LINK_CODE);
    expect(logged).not.toContain(EMAIL);
    expect(logged).not.toContain("raw-session-token");
    vi.restoreAllMocks();
    vi.useRealTimers();
    Platform.OS = "android";
  });

  describe("'Check your email'", () => {
    it("a rejected link shows the link-error card in the red error slot and stays on the view", async () => {
      const screen = await startOnLinkSent();
      await openLink(screen, REJECTED_LINK);

      expect(screen.text()).toContain("Check your email");
      expectLinkErrorCardBetween(screen, "Link expires in", "Resend");
    });

    it("a link that fails on the network shows the calm offline note, no red card", async () => {
      const screen = await startOnLinkSent();
      await openNetworkFailingLink(screen);

      expect(screen.text()).toContain("Check your email");
      expectCalmNoteOnly(screen);
    });

    it("the next attempt clears them: Resend link clears the card, a new link replaces the note and the card", async () => {
      const screen = await startOnLinkSent();
      await openLink(screen, REJECTED_LINK);
      await vi.advanceTimersByTimeAsync(30_000);
      await screen.rerender();
      await screen.press("Resend link");
      expect(screen.text()).toContain(`We sent a new link to ${EMAIL}.`);
      expect(screen.text()).not.toContain(EXPIRED_MESSAGE);

      await openNetworkFailingLink(screen);
      expectCalmNoteOnly(screen);

      unreachablePaths.clear();
      await openLink(screen, REJECTED_LINK);
      expectLinkErrorCardBetween(screen, "Link expires in", "Resend");

      await openNetworkFailingLink(screen);
      expectCalmNoteOnly(screen);
    });

    it("a new rejected link after a Resend that failed offline shows only the card", async () => {
      const screen = await startOnLinkSent();
      await vi.advanceTimersByTimeAsync(30_000);
      await screen.rerender();
      unreachablePaths.add("/sign-in/magic-link");
      await screen.press("Resend link");
      expect(screen.text()).toContain(SERVER_UNREACHABLE_NOTE);

      await openLink(screen, REJECTED_LINK);
      expectLinkErrorCardBetween(screen, "Link expires in", "Resend");
    });

    it("screen reader: the card is announced once when it mounts", async () => {
      Platform.OS = "ios";
      const screen = await startOnLinkSent();
      await openLink(screen, REJECTED_LINK);
      await screen.rerender();

      expect(announcementsOf(EXPIRED_MESSAGE)).toBe(1);
    });
  });

  describe("code screen", () => {
    it("a rejected link shows the link-error card in the red error slot and stays on the view", async () => {
      const screen = await startOnCodeScreen();
      await openLink(screen, REJECTED_LINK);

      expect(screen.text()).toContain("Enter your code");
      expectLinkErrorCardBetween(screen, "Code expires in", "Resend");
    });

    it("a link that fails on the network shows the calm offline note, no red card", async () => {
      const screen = await startOnCodeScreen();
      await openNetworkFailingLink(screen);

      expect(screen.text()).toContain("Enter your code");
      expectCalmNoteOnly(screen);
    });

    it("the next attempt clears them: a code submit clears the card, Resend code clears the note, a new link replaces the note", async () => {
      const screen = await startOnCodeScreen();
      await openLink(screen, REJECTED_LINK);
      unreachablePaths.add("/sign-in/email-otp");
      await screen.changeText("6-digit code", "123456");
      // The submit failed on the network: its note, and no card from the link before it.
      expectCalmNoteOnly(screen);

      await openLink(screen, REJECTED_LINK);
      expectLinkErrorCardBetween(screen, "Code expires in", "Resend");
      await vi.advanceTimersByTimeAsync(30_000);
      await screen.rerender();
      await screen.press("Resend code");
      expect(screen.text()).toContain(`We sent a new code to ${EMAIL}.`);
      expect(screen.text()).not.toContain(EXPIRED_MESSAGE);

      await openNetworkFailingLink(screen);
      expectCalmNoteOnly(screen);
      await vi.advanceTimersByTimeAsync(30_000);
      await screen.rerender();
      await screen.press("Resend code");
      expect(screen.text()).not.toContain(SERVER_UNREACHABLE_NOTE);

      await openNetworkFailingLink(screen);
      unreachablePaths.delete("/magic-link/exchange");
      await openLink(screen, REJECTED_LINK);
      expectLinkErrorCardBetween(screen, "Code expires in", "Resend");
    });

    it("'Use a different email' drops the card, as on 'Check your email', so the form does not show it again", async () => {
      const screen = await startOnCodeScreen();
      await openLink(screen, REJECTED_LINK);
      await screen.press("Use a different email");

      expect(screen.text()).toContain("Sign in to BJJ Roll");
      expect(screen.text()).not.toContain(EXPIRED_MESSAGE);
    });

    it("screen reader: the card is announced once when it mounts", async () => {
      Platform.OS = "ios";
      const screen = await startOnCodeScreen();
      await openLink(screen, REJECTED_LINK);
      await screen.rerender();

      expect(announcementsOf(EXPIRED_MESSAGE)).toBe(1);
    });
  });
});
