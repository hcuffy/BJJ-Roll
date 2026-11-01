import { SIGN_UP_ATTESTATION_LABEL } from "@bjj-roll/shared";
import { createElement } from "react";
import { AccessibilityInfo, Platform } from "react-native";
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
const { SERVER_UNREACHABLE_NOTE } = await import("../screens/EmailEntryScreen");
const { CODE_SCREEN_INVALID_LINK } = await import("../screens/CodeEntryScreen");

type Screen = Awaited<ReturnType<typeof renderScreen>>;

const EMAIL = "member@example.test";
const LINK_CODE = "one-time-exchange-code";
const REJECTED_LINK = "bjjroll://auth?r=link_invalid";
const EXPIRED_MESSAGE = failureMessages.invalidLink;

describe("App when a sign-in link fails after a send (HEN-304)", () => {
  let backend: ReturnType<typeof createFakeBackend>;
  let unreachablePaths: Set<string>;
  let linkNumber: number;
  const consoleCalls: unknown[][] = [];

  const startApp = async () => {
    appClient.store = createMemorySecureStore();
    seedPendingSignIn(appClient.store);
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
    const message = screen.text().includes("Enter your code") ? CODE_SCREEN_INVALID_LINK : EXPIRED_MESSAGE;
    const card = screen.queryByText(message);
    expect(card?.props).toMatchObject({ accessibilityRole: "alert", accessibilityLiveRegion: "polite" });
    expect(flattenStyle(card?.props.style).color).toBe(colours.danger);
    const text = screen.text();
    expect(text.indexOf(message)).toBeGreaterThan(text.indexOf(above));
    expect(text.indexOf(message)).toBeLessThan(text.indexOf(below));
    expect(text.split(message)).toHaveLength(2);
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
  const actRefused = async (screen: Screen, act: () => Promise<unknown>, code?: string) => {
    await vi.advanceTimersByTimeAsync(30_000).then(() => screen.rerender());
    backend.fetchImplementation.mockResolvedValueOnce(Response.json({ code, message: "Refused" }, { status: code ? 400 : 429 }));
    await act();
    expect(redTexts(screen).length).toBeGreaterThan(0);
  };
  const expectOnlyTheCardIsRed = (screen: Screen, message: string) => expect(redTexts(screen).map((text) => text.props.children)).toEqual([message]);
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

    it("an old card goes when a new link fails: on the network it becomes the calm note, rejected again it is one card (Bill)", async () => {
      const screen = await startOnLinkSent();
      await openLink(screen, REJECTED_LINK);
      expectLinkErrorCardBetween(screen, "Link expires in", "Resend");

      await openNetworkFailingLink(screen);
      expectCalmNoteOnly(screen);

      unreachablePaths.clear();
      await openLink(screen, REJECTED_LINK);
      expectLinkErrorCardBetween(screen, "Link expires in", "Resend");
      await openLink(screen, REJECTED_LINK);
      expectLinkErrorCardBetween(screen, "Link expires in", "Resend");
    });

    it("an old red form error goes when a new link fails: a failed Resend link is replaced by the card (Bill)", async () => {
      const screen = await startOnLinkSent();
      await actRefused(screen, () => screen.press("Resend link"));
      await openLink(screen, REJECTED_LINK);
      expectOnlyTheCardIsRed(screen, EXPIRED_MESSAGE);
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
      expectCalmNoteOnly(screen);

      await openLink(screen, REJECTED_LINK);
      expectLinkErrorCardBetween(screen, "Code expires in", "Resend");
      await vi.advanceTimersByTimeAsync(30_000);
      await screen.rerender();
      await screen.press("Resend code");
      expect(screen.text()).toContain(`We sent a new code to ${EMAIL}.`);
      expect(screen.text()).not.toContain(CODE_SCREEN_INVALID_LINK);

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
      expect(screen.text()).not.toContain(CODE_SCREEN_INVALID_LINK);
    });

    it("old red errors go when a new link fails: a failed Resend code, then a wrong code, are replaced by the card (Bill)", async () => {
      const screen = await startOnCodeScreen();
      await actRefused(screen, () => screen.press("Resend code"));
      await openLink(screen, REJECTED_LINK);
      expectOnlyTheCardIsRed(screen, CODE_SCREEN_INVALID_LINK);

      await actRefused(screen, () => screen.changeText("6-digit code", "123456"), "INVALID_OTP");
      await openLink(screen, REJECTED_LINK);
      expectOnlyTheCardIsRed(screen, CODE_SCREEN_INVALID_LINK);
    });

    it("screen reader: the card is announced once when it mounts", async () => {
      Platform.OS = "ios";
      const screen = await startOnCodeScreen();
      await openLink(screen, REJECTED_LINK);
      await screen.rerender();

      expect(announcementsOf(CODE_SCREEN_INVALID_LINK)).toBe(1);
    });
  });
});
