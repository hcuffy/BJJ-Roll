import { AGE_GATE_REFUSAL_MESSAGE } from "@bjj-roll/shared";
import { createElement } from "react";
import { AccessibilityInfo, Platform } from "react-native";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAGIC_LINK_EXPIRY_MINUTES } from "../auth/signInActions";
import { createMobileAuthClient } from "../auth/authClient";
import { EmailEntryScreen } from "../screens/EmailEntryScreen";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL } from "./authTestDoubles";
import { colours } from "../theme/tokens";
import { flattenStyle, renderScreen, textOf } from "./screenHarness";

describe("EmailEntryScreen", () => {
  let backend: ReturnType<typeof createFakeBackend>;
  let client: ReturnType<typeof createMobileAuthClient>;
  let sentTo: string[];
  let sentAdult: boolean[];

  beforeEach(() => {
    backend = createFakeBackend();
    client = createMobileAuthClient({
      backendUrl: TEST_BACKEND_URL,
      storage: createMemorySecureStore(),
      fetchImplementation: backend.fetchImplementation,
    });
    sentTo = [];
    sentAdult = [];
    vi.mocked(AccessibilityInfo.announceForAccessibility).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    Platform.OS = "android";
  });

  const renderEmailEntry = () =>
    renderScreen(
      createElement(EmailEntryScreen, {
        client,
        onCodeSent: (email, age18Confirmed) => {
          sentTo.push(email);
          sentAdult.push(age18Confirmed);
        },
      }),
    );

  it("shows the 16+ checkbox unticked and an email field without a password field", async () => {
    const screen = await renderEmailEntry();

    expect(screen.getByRole("checkbox").props.accessibilityState).toEqual({ checked: false, disabled: false });
    expect(screen.findAllByType("Text").map(textOf)).toContain("Email");
    expect(screen.queryByText("I am 16 or older")).not.toBeNull();
    expect(screen.findAllByType("TextInput").map((input) => input.props.accessibilityLabel)).toEqual(["Email"]);
    expect(screen.findAllByType("TextInput").some((input) => input.props.secureTextEntry === true)).toBe(false);
  });

  it("makes Continue look disabled until ready, and a tap says what is missing instead of sending", async () => {
    const screen = await renderEmailEntry();
    await screen.changeText("Email", "member@example.test");

    expect(flattenStyle(screen.getPressable("Continue").props.style).backgroundColor).toBe(colours.surfaceRaised);
    expect(flattenStyle(screen.queryByText("Continue")?.props.style).color).toBe(colours.textSecondary);
    // Dimmed, but still pressable, so it must not tell screen readers it is disabled; the hint explains what is missing.
    expect(screen.getPressable("Continue").props.disabled).toBe(false);
    expect(screen.getPressable("Continue").props.accessibilityState).toMatchObject({ disabled: false });
    expect(screen.getPressable("Continue").props.accessibilityHint).toBe("Tick the 16 or older box first.");
    await screen.press("Continue");
    expect(screen.text()).toContain("Tick the box to confirm you are 16 or older.");
    expect(screen.getByRole("checkbox").props.accessibilityHint).toBe("Tick the box to confirm you are 16 or older.");
    await screen.press("Email me a sign-in link instead");

    expect(backend.fetchImplementation).not.toHaveBeenCalled();
    expect(sentTo).toEqual([]);

    await screen.pressRole("checkbox");
    expect(screen.text()).not.toContain("Tick the box to confirm");
    expect(flattenStyle(screen.getPressable("Continue").props.style).backgroundColor).toBe(colours.primary);
  });

  it("hints only what is missing, on both dimmed send buttons, and drops the hint once ready", async () => {
    const hints = (screen: Awaited<ReturnType<typeof renderEmailEntry>>) => [
      screen.getPressable("Continue").props.accessibilityHint,
      screen.getPressable("Email me a sign-in link instead").props.accessibilityHint,
    ];
    const screen = await renderEmailEntry();
    expect(hints(screen)).toEqual(Array(2).fill("Enter your email and tick the 16 or older box first."));

    await screen.changeText("Email", "member@example.test");
    expect(hints(screen)).toEqual(Array(2).fill("Tick the 16 or older box first."));

    await screen.pressRole("checkbox");
    expect(hints(screen)).toEqual([undefined, undefined]);

    await screen.changeText("Email", "member@example");
    expect(hints(screen)).toEqual(Array(2).fill("Enter your email first."));
  });

  it("shows an inline email error when the field is left with an invalid address, and clears it on edit", async () => {
    const screen = await renderEmailEntry();
    await screen.fire("Email", "onBlur");
    expect(screen.text()).not.toContain("Enter a valid email address.");

    await screen.changeText("Email", "member@example");
    await screen.fire("Email", "onBlur");

    expect(screen.text()).toContain("Enter a valid email address.");
    expect(screen.getByLabelText("Email").props.accessibilityHint).toBe("Enter a valid email address.");
    expect(flattenStyle(screen.getByLabelText("Email").props.style)).toMatchObject({ borderColor: colours.danger, borderWidth: 2 });

    await screen.changeText("Email", "member@example.test");
    expect(screen.text()).not.toContain("Enter a valid email address.");
  });

  it("tells the user to fix the email when they tap Continue with the box ticked but no valid email", async () => {
    const screen = await renderEmailEntry();
    await screen.pressRole("checkbox");
    await screen.press("Continue");

    expect(screen.text()).toContain("Enter a valid email address.");
    expect(backend.fetchImplementation).not.toHaveBeenCalled();
  });

  it("highlights the focused field with a 2pt lime border", async () => {
    const screen = await renderEmailEntry();
    await screen.fire("Email", "onFocus");
    expect(flattenStyle(screen.getByLabelText("Email").props.style)).toMatchObject({ borderColor: colours.primary, borderWidth: 2 });
    await screen.fire("Email", "onBlur");
    expect(flattenStyle(screen.getByLabelText("Email").props.style)).toMatchObject({ borderColor: colours.border, borderWidth: 1 });
  });

  it("submits from the keyboard: the email field has return key Go and no autocorrect", async () => {
    const screen = await renderEmailEntry();
    expect(screen.getByLabelText("Email").props).toMatchObject({ returnKeyType: "go", autoCorrect: false, autoCapitalize: "none" });
    await screen.pressRole("checkbox");
    await screen.changeText("Email", "member@example.test");
    await screen.fire("Email", "onSubmitEditing");

    expect(sentTo).toEqual(["member@example.test"]);
  });

  it("shows a busy Continue (label, spinner, same size) while the code is being sent", async () => {
    let release: (response: Response) => void = () => undefined;
    backend.fetchImplementation.mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)));
    const screen = await renderEmailEntry();
    await screen.pressRole("checkbox");
    await screen.changeText("Email", "member@example.test");
    const idleHeight = flattenStyle(screen.getPressable("Continue").props.style).minHeight;
    await screen.press("Continue");

    const busyButton = screen.getPressable("Sending code…");
    expect(busyButton.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    expect(busyButton.props.disabled).toBe(true);
    expect(busyButton.children.some((child) => typeof child !== "string" && child.type === "ActivityIndicator")).toBe(true);
    expect(flattenStyle(busyButton.props.style).minHeight).toBe(idleHeight);
    expect(screen.isDisabled("Email me a sign-in link instead")).toBe(true);

    release(Response.json({ status: true }));
    await screen.rerender();
    expect(sentTo).toEqual(["member@example.test"]);
  });
  it("sends the code request with age16Confirmed true once ticked, then hands over the email", async () => {
    const screen = await renderEmailEntry();
    await screen.changeText("Email", " member@example.test ");
    await screen.pressRole("checkbox");

    expect(screen.isDisabled("Continue")).toBe(false);
    await screen.press("Continue");

    expect(backend.requests.map((request) => [new URL(request.url).pathname, request.body])).toEqual([
      ["/api/auth/email-otp/send-verification-otp", { email: "member@example.test", type: "sign-in", age16Confirmed: true, age18Confirmed: false }],
    ]);
    expect(sentTo).toEqual(["member@example.test"]);
    expect(sentAdult).toEqual([false]);
  });

  it("sends age18Confirmed true with the code and the link when the 18+ box is ticked, and hands it over with the email", async () => {
    const screen = await renderEmailEntry();
    await screen.changeText("Email", "member@example.test");
    await screen.pressRole("checkbox");
    (screen.getByLabelText("I am 18 or older").props.onPress as () => void)();
    await screen.rerender();
    await screen.press("Email me a sign-in link instead");
    await screen.press("Use a different email");
    await screen.press("Continue");

    expect(backend.requests.map((request) => request.body)).toEqual([
      { email: "member@example.test", callbackURL: "bjjroll://auth", age16Confirmed: true, age18Confirmed: true },
      { email: "member@example.test", type: "sign-in", age16Confirmed: true, age18Confirmed: true },
    ]);
    expect(sentAdult).toEqual([true]);
  });

  it("shows the shared 16+ refusal message when the backend refuses with AGE_CONFIRMATION_REQUIRED", async () => {
    const serverWording = "Server wording for the age gate";
    backend.fetchImplementation.mockImplementationOnce(() =>
      Promise.resolve(Response.json({ code: "AGE_CONFIRMATION_REQUIRED", message: serverWording }, { status: 400 })),
    );
    const screen = await renderEmailEntry();
    await screen.changeText("Email", "member@example.test");
    await screen.pressRole("checkbox");
    await screen.press("Continue");

    expect(screen.queryByText(AGE_GATE_REFUSAL_MESSAGE)).not.toBeNull();
    expect(sentTo).toEqual([]);
  });

  it("announces errors: polite live region on Android, an announcement on iOS", async () => {
    backend.fetchImplementation.mockRejectedValue(new TypeError("Network request failed"));
    const screen = await renderEmailEntry();
    await screen.pressRole("checkbox");
    await screen.changeText("Email", "member@example.test");
    await screen.press("Continue");

    const errorText = screen.queryByText("No connection. Check your internet and try again.");
    expect(errorText?.props).toMatchObject({ accessibilityLiveRegion: "polite", accessibilityRole: "alert" });

    Platform.OS = "ios";
    const iosScreen = await renderEmailEntry();
    await iosScreen.pressRole("checkbox");
    await iosScreen.changeText("Email", "member@example.test");
    await iosScreen.press("Continue");
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith("No connection. Check your internet and try again.");
  });

  it("keeps the link expiry copy in step with the backend's MAGIC_LINK_EXPIRY_MINUTES", () => {
    const backendLimits = readFileSync(new URL("../../../backend/src/auth/authLimits.ts", import.meta.url), "utf8");
    expect(Number(/export const MAGIC_LINK_EXPIRY_MINUTES = (\d+);/.exec(backendLimits)?.[1])).toBe(MAGIC_LINK_EXPIRY_MINUTES);
  });

  it("after the link is sent, replaces the form with a 'Check your email' notice (not error style) with Resend link", async () => {
    vi.useFakeTimers();
    const screen = await renderEmailEntry();
    await screen.pressRole("checkbox");
    await screen.changeText("Email", "member@example.test");
    await screen.press("Email me a sign-in link instead");

    expect(screen.text()).toContain("Check your email");
    const notice = screen.queryByText("We sent a sign-in link to member@example.test. Open it on this phone.");
    expect(notice).not.toBeNull();
    expect(flattenStyle(notice?.props.style).color).toBe(colours.textPrimary);
    expect(screen.findAllByType("Text").some((text) => flattenStyle(text.props.style).color === colours.danger)).toBe(false);
    expect(screen.findAllByType("TextInput")).toEqual([]);
    expect(flattenStyle(screen.queryByText(`Link expires in ${MAGIC_LINK_EXPIRY_MINUTES} minutes.`)?.props.style).color).toBe(colours.textSecondary);

    // Same 30s cooldown as Resend code.
    expect(screen.getPressable("Resend in 0:30").props.disabled).toBe(true);
    // Blocked: no fill and a muted label. Ready again: the surface-2 pill with a white label.
    expect(flattenStyle(screen.getPressable("Resend in 0:30").props.style).backgroundColor).toBe("transparent");
    expect(flattenStyle(screen.queryByText("Resend in 0:30")?.props.style).color).toBe(colours.textSecondary);
    await vi.advanceTimersByTimeAsync(30_000);
    await screen.rerender();
    expect(flattenStyle(screen.getPressable("Resend link").props.style).backgroundColor).toBe(colours.surfaceRaised);
    expect(flattenStyle(screen.queryByText("Resend link")?.props.style).color).toBe(colours.textPrimary);
    await screen.press("Resend link");
    expect(backend.requests.filter((request) => request.url.endsWith("/sign-in/magic-link"))).toHaveLength(2);
    expect(screen.text()).toContain("We sent a new link to member@example.test.");
    expect(screen.getPressable("Resend in 0:30").props.disabled).toBe(true);

    await screen.press("Use a different email");
    expect(screen.getByLabelText("Email").props.value).toBe("member@example.test");
    expect(screen.getByRole("checkbox").props.accessibilityState).toMatchObject({ checked: true });
    expect(textOf(screen.getByRole("checkbox"))).toContain("I am 16 or older");
  });
});
