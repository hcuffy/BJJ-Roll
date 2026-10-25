import { readFileSync } from "node:fs";
import { createElement } from "react";
import { AccessibilityInfo, Platform } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OTP_EXPIRY_MINUTES } from "../auth/signInActions";
import { createMobileAuthClient } from "../auth/authClient";
import { CodeEntryScreen } from "../screens/CodeEntryScreen";
import { colours } from "../theme/tokens";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL } from "./authTestDoubles";
import { flattenStyle, renderScreen } from "./screenHarness";

describe("CodeEntryScreen", () => {
  let backend: ReturnType<typeof createFakeBackend>;
  let client: ReturnType<typeof createMobileAuthClient>;
  let signedIn: number;
  let backPresses: number;

  beforeEach(() => {
    backend = createFakeBackend();
    client = createMobileAuthClient({
      backendUrl: TEST_BACKEND_URL,
      storage: createMemorySecureStore(),
      fetchImplementation: backend.fetchImplementation,
    });
    signedIn = 0;
    backPresses = 0;
    vi.mocked(AccessibilityInfo.announceForAccessibility).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    Platform.OS = "android";
  });

  const renderCodeEntry = () =>
    renderScreen(
      createElement(CodeEntryScreen, {
        client,
        email: "member@example.test",
        onSignedIn: () => (signedIn += 1),
        onBack: () => (backPresses += 1),
      }),
    );
  const signInRequests = () => backend.requests.filter((request) => request.url.endsWith("/sign-in/email-otp"));
  const sendRequests = () => backend.requests.filter((request) => request.url.endsWith("/email-otp/send-verification-otp"));

  it("names the address, shows the real expiry, and labels a focused code field with return key Done", async () => {
    const screen = await renderCodeEntry();

    expect(screen.text()).toContain("We emailed a 6-digit code to member@example.test.");
    expect(screen.text()).toContain("Code expires in 10 minutes.");
    expect(screen.text()).toContain("6-digit code");
    expect(screen.getByLabelText("6-digit code").props).toMatchObject({
      autoFocus: true,
      returnKeyType: "done",
      keyboardType: "number-pad",
      textContentType: "oneTimeCode",
      maxLength: 6,
    });
  });

  it("keeps the expiry copy in step with the backend's OTP_EXPIRY_MINUTES", () => {
    const backendLimits = readFileSync(new URL("../../../backend/src/auth/authLimits.ts", import.meta.url), "utf8");
    const backendMinutes = /export const OTP_EXPIRY_MINUTES = (\d+);/.exec(backendLimits)?.[1];
    expect(Number(backendMinutes)).toBe(OTP_EXPIRY_MINUTES);
  });

  it("signs in automatically once the 6th digit is typed, exactly once, with ageConfirmed true", async () => {
    const screen = await renderCodeEntry();
    await screen.changeText("6-digit code", "12345");
    expect(screen.isDisabled("Sign in")).toBe(true);
    expect(signInRequests()).toHaveLength(0);

    await screen.changeText("6-digit code", "123456");

    expect(signInRequests()).toHaveLength(1);
    expect(signInRequests()[0]?.body).toEqual({ email: "member@example.test", otp: "123456", ageConfirmed: true });
    expect(signedIn).toBe(1);
  });

  it("signs in from the keyboard Done key too", async () => {
    const screen = await renderCodeEntry();
    await screen.fire("6-digit code", "onSubmitEditing");
    expect(signInRequests()).toHaveLength(0);
    expect(screen.text()).toContain("Enter the 6-digit code from the email.");
  });

  it("shows 'Signing in…' with a spinner and busy state, and locks 'Use a different email' while verifying", async () => {
    let release: (response: Response) => void = () => undefined;
    backend.fetchImplementation.mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)));
    const screen = await renderCodeEntry();
    await screen.changeText("6-digit code", "123456");

    const busyButton = screen.getPressable("Signing in…");
    expect(busyButton.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    expect(busyButton.props.disabled).toBe(true);
    expect(busyButton.children.some((child) => typeof child !== "string" && child.type === "ActivityIndicator")).toBe(true);
    expect(screen.isDisabled("Use a different email")).toBe(true);
    await screen.press("Use a different email");
    expect(backPresses).toBe(0);

    release(Response.json({ code: "INVALID_OTP", message: "Invalid OTP" }, { status: 400 }));
    await screen.rerender();
    expect(screen.isDisabled("Use a different email")).toBe(false);
  });

  it("shows a friendly, announced error under the code field when the code is wrong", async () => {
    backend.fetchImplementation.mockImplementationOnce(() =>
      Promise.resolve(Response.json({ code: "INVALID_OTP", message: "Invalid OTP" }, { status: 400 })),
    );
    Platform.OS = "ios";
    const screen = await renderCodeEntry();
    await screen.changeText("6-digit code", "000000");

    const message = "That code didn't work. Check the email or send a new code.";
    expect(screen.queryByText(message)?.props).toMatchObject({ accessibilityLiveRegion: "polite", accessibilityRole: "alert" });
    expect(flattenStyle(screen.queryByText(message)?.props.style).color).toBe(colours.danger);
    expect(screen.text()).not.toContain("Invalid OTP");
    expect(screen.getByLabelText("6-digit code").props.accessibilityHint).toBe(message);
    expect(flattenStyle(screen.getByLabelText("6-digit code").props.style)).toMatchObject({ borderColor: colours.danger, borderWidth: 2 });
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(message);
    expect(signedIn).toBe(0);
  });

  it("lets the user retry after a wrong code", async () => {
    backend.fetchImplementation.mockImplementationOnce(() =>
      Promise.resolve(Response.json({ code: "INVALID_OTP", message: "Invalid OTP" }, { status: 400 })),
    );
    const screen = await renderCodeEntry();
    await screen.changeText("6-digit code", "000000");
    await screen.rerender();
    expect(signedIn).toBe(0);

    await screen.changeText("6-digit code", "123456");
    await screen.rerender();

    expect(signedIn).toBe(1);
  });

  it("offers Resend code after a 30 second countdown, sends a new code, and restarts the countdown", async () => {
    vi.useFakeTimers();
    const screen = await renderCodeEntry();

    expect(screen.getPressable("Resend in 0:30").props.disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(29_000);
    await screen.rerender();
    expect(screen.text()).toContain("Resend in 0:01");
    await vi.advanceTimersByTimeAsync(1000);
    await screen.rerender();
    expect(screen.isDisabled("Resend code")).toBe(false);

    await screen.press("Resend code");

    expect(sendRequests()).toHaveLength(1);
    expect(sendRequests()[0]?.body).toEqual({ email: "member@example.test", type: "sign-in", ageConfirmed: true });
    const notice = "We sent a new code to member@example.test.";
    expect(screen.queryByText(notice)?.props.accessibilityLiveRegion).toBe("polite");
    // A muted confirmation line, not plain white body text and not an error.
    expect(flattenStyle(screen.queryByText(notice)?.props.style).color).toBe(colours.textSecondary);
    expect(screen.getPressable("Resend in 0:30").props.disabled).toBe(true);
  });

  it("sends one request when the 6th digit and the Done key arrive in the same tick (same render's handlers)", async () => {
    const screen = await renderCodeEntry();
    await screen.changeText("6-digit code", "12345");
    // Both handlers come from one render, as when autofill delivers the last digit and Done fires before React re-renders.
    const { onChangeText, onSubmitEditing } = screen.getByLabelText("6-digit code").props as {
      onChangeText: (text: string) => void;
      onSubmitEditing: () => void;
    };
    onChangeText("123456");
    onSubmitEditing();
    await screen.rerender();

    expect(signInRequests()).toHaveLength(1);
    expect(signInRequests()[0]?.body).toMatchObject({ otp: "123456" });
    expect(screen.text()).not.toContain("Enter the 6-digit code from the email.");
  });

  it("goes back with 'Use a different email'", async () => {
    const screen = await renderCodeEntry();
    await screen.press("Use a different email");
    expect(backPresses).toBe(1);
  });
});
