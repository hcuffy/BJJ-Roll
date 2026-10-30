import { SIGN_UP_ATTESTATION_LABEL } from "@bjj-roll/shared";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMobileAuthClient } from "../auth/authClient";
import { FAILURE_MESSAGES } from "../auth/signInActions";
import { CODE_SCREEN_INVALID_LINK, CodeEntryScreen } from "../screens/CodeEntryScreen";
import { EmailEntryScreen } from "../screens/EmailEntryScreen";
import { colours } from "../theme/tokens";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL } from "./authTestDoubles";
import { flattenStyle, renderScreen } from "./screenHarness";

type Screen = Awaited<ReturnType<typeof renderScreen>>;
interface FailedLink {
  readonly linkError: string | null;
  readonly linkAttempt: number;
}

const EMAIL = "member@example.test";
const CARD = FAILURE_MESSAGES.invalidLink;

/**
 * HEN-311 (Vera, HEN-304 fix 1): one red message at a time. App sets a failed link's card and bumps linkAttempt in one
 * (batched) render, so the screen must hide its own older red error in that render, before any effect clears it.
 */
describe("sign-in screens hide stale red errors while the link-error card is shown (HEN-311)", () => {
  let backend: ReturnType<typeof createFakeBackend>;
  let link: FailedLink;
  let frames: string[];
  const linkProps = () => ({ ...link, linkErrorReason: "invalidLink" as const, onClearLinkError: () => (link = { ...link, linkError: null }) });

  const newClient = () =>
    createMobileAuthClient({ backendUrl: TEST_BACKEND_URL, storage: createMemorySecureStore(), fetchImplementation: backend.fetchImplementation });
  const renderEmailEntry = async () => {
    const client = newClient();
    const Host = () => createElement(EmailEntryScreen, { client, onCodeSent: () => undefined, ...linkProps() });
    const screen = await renderScreen(createElement(Host), (text) => frames.push(text));
    await screen.pressRole("checkbox");
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    await screen.changeText("Email", EMAIL);
    return screen;
  };
  const renderCodeEntry = () => {
    const client = newClient();
    const Host = () => createElement(CodeEntryScreen, { client, email: EMAIL, onSignedIn: () => undefined, onBack: () => undefined, ...linkProps() });
    return renderScreen(createElement(Host), (text) => frames.push(text));
  };
  const redTexts = (screen: Screen) =>
    screen
      .findAllByType("Text")
      .filter((text) => flattenStyle(text.props.style).color === colours.danger)
      .map((text) => String(text.props.children));
  /** Past the resend cooldown, the next request is refused (429, or 400 with `code`); returns the red error it left. */
  const actRefused = async (screen: Screen, act: () => Promise<unknown>, code?: string) => {
    await vi.advanceTimersByTimeAsync(30_000).then(() => screen.rerender());
    backend.fetchImplementation.mockResolvedValueOnce(Response.json({ code, message: "Refused" }, { status: code ? 400 : 429 }));
    await act();
    const [stale = ""] = redTexts(screen);
    expect(stale).not.toBe("");
    return stale;
  };
  /** A failed link arrives as App sends it: the card and a new attempt in the same render. */
  const linkFails = async (screen: Screen, card: string) => {
    frames = [];
    link = { linkError: CARD, linkAttempt: link.linkAttempt + 1 };
    await screen.rerender();
    expect(frames.some((frame) => frame.includes(card))).toBe(true);
    return frames;
  };
  const expectNoFrameWith = (rendered: string[], card: string, stale: string) =>
    expect(rendered.filter((frame) => frame.includes(card) && frame.includes(stale))).toEqual([]);

  beforeEach(() => {
    vi.useFakeTimers();
    backend = createFakeBackend();
    link = { linkError: null, linkAttempt: 0 };
    frames = [];
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("'Check your email': a failed Resend link's red error never shows next to the card", async () => {
    const screen = await renderEmailEntry();
    await screen.press("Email me a sign-in link instead");
    expect(screen.text()).toContain("Check your email");
    const stale = await actRefused(screen, () => screen.press("Resend link"));

    expectNoFrameWith(await linkFails(screen, CARD), CARD, stale);
  });

  it("email form: a failed Continue's red error never shows next to the card", async () => {
    const screen = await renderEmailEntry();
    const stale = await actRefused(screen, () => screen.press("Continue with email"));

    expectNoFrameWith(await linkFails(screen, CARD), CARD, stale);
  });

  it("code screen: a failed Resend code's red error never shows next to the card", async () => {
    const screen = await renderCodeEntry();
    const stale = await actRefused(screen, () => screen.press("Resend code"));

    expectNoFrameWith(await linkFails(screen, CODE_SCREEN_INVALID_LINK), CODE_SCREEN_INVALID_LINK, stale);
  });

  it("code screen: a wrong code's red field error never shows next to the card; a new error after the card shows again", async () => {
    const screen = await renderCodeEntry();
    const stale = await actRefused(screen, () => screen.changeText("6-digit code", "123456"), "INVALID_OTP");

    expectNoFrameWith(await linkFails(screen, CODE_SCREEN_INVALID_LINK), CODE_SCREEN_INVALID_LINK, stale);
    // The next submit dismisses the card; its own new error shows.
    expect(await actRefused(screen, () => screen.changeText("6-digit code", "654321"), "INVALID_OTP")).toBe(stale);
    expect(screen.text()).not.toContain(CODE_SCREEN_INVALID_LINK);
  });
});
