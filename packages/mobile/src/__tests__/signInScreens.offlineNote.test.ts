import { createElement } from "react";
import { AccessibilityInfo, Platform } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMobileAuthClient } from "../auth/authClient";
import { CodeEntryScreen } from "../screens/CodeEntryScreen";
import { EmailEntryScreen, SERVER_UNREACHABLE_NOTE } from "../screens/EmailEntryScreen";
import { colours } from "../theme/tokens";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL } from "./authTestDoubles";
import { flattenStyle, renderScreen } from "./screenHarness";

type Screen = Awaited<ReturnType<typeof renderScreen>>;

/** HEN-287: every sign-in screen says "can't reach the server" the same calm way, and keeps red for real errors. */
describe("sign-in screens when the server cannot be reached (HEN-287)", () => {
  let backend: ReturnType<typeof createFakeBackend>;
  let client: ReturnType<typeof createMobileAuthClient>;
  let serverDown: boolean;
  let codesSentTo: string[];
  let signedIn: number;

  beforeEach(() => {
    backend = createFakeBackend();
    serverDown = true;
    codesSentTo = [];
    signedIn = 0;
    client = createMobileAuthClient({
      backendUrl: TEST_BACKEND_URL,
      storage: createMemorySecureStore(),
      fetchImplementation: vi.fn((input: string | URL | Request, init?: RequestInit) =>
        serverDown ? Promise.reject(new TypeError("Network request failed")) : backend.fetchImplementation(input, init),
      ),
    });
    vi.mocked(AccessibilityInfo.announceForAccessibility).mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    Platform.OS = "android";
  });

  const renderEmailEntry = () => renderScreen(createElement(EmailEntryScreen, { client, onCodeSent: (email) => codesSentTo.push(email) }));
  const renderCodeEntry = () =>
    renderScreen(
      createElement(CodeEntryScreen, { client, email: "member@example.test", onSignedIn: () => (signedIn += 1), onBack: () => undefined }),
    );
  const fillEmailForm = async (screen: Screen) => {
    await screen.pressRole("checkbox");
    await screen.changeText("Email", "member@example.test");
  };
  const redTexts = (screen: Screen) => screen.findAllByType("Text").filter((text) => flattenStyle(text.props.style).color === colours.danger);

  const expectCalmNote = (screen: Screen) => {
    const note = screen.queryByText(SERVER_UNREACHABLE_NOTE);
    expect(note?.props).toMatchObject({ accessibilityLiveRegion: "polite" });
    expect(note?.props.accessibilityRole).toBeUndefined();
    expect(flattenStyle(note?.props.style)).toMatchObject({ fontSize: 15, lineHeight: 22, color: colours.textSecondary });
    expect(screen.text()).not.toContain("No connection.");
    expect(redTexts(screen)).toEqual([]);
  };

  it("email form: Continue offline shows the calm note, not red; once the server is back Continue sends the code", async () => {
    const screen = await renderEmailEntry();
    await fillEmailForm(screen);
    await screen.press("Continue with email");
    expectCalmNote(screen);

    serverDown = false;
    await screen.press("Continue with email");
    expect(codesSentTo).toEqual(["member@example.test"]);
    expect(screen.text()).not.toContain(SERVER_UNREACHABLE_NOTE);
  });

  it("email form: the link button offline shows the same calm note", async () => {
    const screen = await renderEmailEntry();
    await fillEmailForm(screen);
    await screen.press("Email me a sign-in link instead");
    expectCalmNote(screen);
    expect(screen.text()).not.toContain("Check your email");
  });

  it("a retry that fails offline again keeps the calm note, not red (startup note → failed Continue)", async () => {
    const screen = await renderScreen(createElement(EmailEntryScreen, { client, onCodeSent: () => undefined, serverUnreachable: true }));
    expectCalmNote(screen);
    await fillEmailForm(screen);
    await screen.press("Continue with email");
    expectCalmNote(screen);
  });

  it("'Check your email': Resend link offline shows the calm note; once back, Resend link works", async () => {
    vi.useFakeTimers();
    serverDown = false;
    const screen = await renderEmailEntry();
    await fillEmailForm(screen);
    await screen.press("Email me a sign-in link instead");
    await vi.advanceTimersByTimeAsync(30_000);
    await screen.rerender();

    serverDown = true;
    await screen.press("Resend link");
    expect(screen.text()).toContain("Check your email");
    expectCalmNote(screen);

    serverDown = false;
    await screen.press("Resend link");
    expect(screen.text()).toContain("We sent a new link to member@example.test.");
    expect(screen.text()).not.toContain(SERVER_UNREACHABLE_NOTE);
  });

  it("'Check your email': after a failed resend, 'Use a different email' drops the note, with no repeat announcement", async () => {
    vi.useFakeTimers();
    Platform.OS = "ios";
    serverDown = false;
    const screen = await renderEmailEntry();
    await fillEmailForm(screen);
    await screen.press("Email me a sign-in link instead");
    await vi.advanceTimersByTimeAsync(30_000);
    await screen.rerender();
    serverDown = true;
    await screen.press("Resend link");
    expectCalmNote(screen);

    vi.mocked(AccessibilityInfo.announceForAccessibility).mockClear();
    await screen.press("Use a different email");
    expect(screen.text()).toContain("Sign in to BJJ Roll");
    expect(screen.text()).not.toContain(SERVER_UNREACHABLE_NOTE);
    expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalledWith(SERVER_UNREACHABLE_NOTE);
  });

  it("code screen: signing in offline shows the calm note, announced on iOS; once back, the code signs in", async () => {
    Platform.OS = "ios";
    const screen = await renderCodeEntry();
    await screen.changeText("6-digit code", "123456");
    expectCalmNote(screen);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(SERVER_UNREACHABLE_NOTE);
    expect(screen.getByLabelText("6-digit code").props.accessibilityHint).toBeUndefined();

    serverDown = false;
    await screen.press("Sign in");
    expect(signedIn).toBe(1);
    expect(screen.text()).not.toContain(SERVER_UNREACHABLE_NOTE);
  });

  it("code screen: Resend code offline shows the calm note; once back, Resend code sends", async () => {
    vi.useFakeTimers();
    const screen = await renderCodeEntry();
    await vi.advanceTimersByTimeAsync(30_000);
    await screen.rerender();
    await screen.press("Resend code");
    expectCalmNote(screen);

    serverDown = false;
    await screen.press("Resend code");
    expect(screen.text()).toContain("We sent a new code to member@example.test.");
    expect(screen.text()).not.toContain(SERVER_UNREACHABLE_NOTE);
  });

  it("real errors stay red: a wrong code on the code screen, a rate limit on the email form", async () => {
    serverDown = false;
    backend.fetchImplementation.mockImplementationOnce(() =>
      Promise.resolve(Response.json({ code: "INVALID_OTP", message: "Invalid OTP" }, { status: 400 })),
    );
    const codeScreen = await renderCodeEntry();
    await codeScreen.changeText("6-digit code", "000000");
    expect(flattenStyle(codeScreen.queryByText("That code didn't work.")?.props.style).color).toBe(colours.danger);
    expect(codeScreen.text()).not.toContain(SERVER_UNREACHABLE_NOTE);

    backend.fetchImplementation.mockImplementationOnce(() => Promise.resolve(Response.json({ message: "Too many" }, { status: 429 })));
    const emailScreen = await renderEmailEntry();
    await fillEmailForm(emailScreen);
    await emailScreen.press("Continue with email");
    expect(emailScreen.queryByText("Too many tries.")?.props).toMatchObject({ accessibilityRole: "alert", accessibilityLiveRegion: "polite" });
    expect(flattenStyle(emailScreen.queryByText("Too many tries.")?.props.style).color).toBe(colours.danger);
    expect(emailScreen.text()).not.toContain(SERVER_UNREACHABLE_NOTE);
  });
});
