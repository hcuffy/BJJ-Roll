import { createElement, type ReactElement } from "react";
import { Platform } from "react-native";
import { afterEach, describe, expect, it } from "vitest";
import { createMobileAuthClient } from "../auth/authClient";
import { CodeEntryScreen } from "../screens/CodeEntryScreen";
import { DeleteAccountCodeStep } from "../screens/DeleteAccountCodeStep";
import { EmailEntryScreen } from "../screens/EmailEntryScreen";
import { SignedInScreen } from "../screens/SignedInScreen";
import { colours, radius, sizes } from "../theme/tokens";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL } from "./authTestDoubles";
import { emitKeyboardEvent, resetKeyboardListeners } from "./keyboardHarness";
import { flattenStyle, renderScreen, safeAreaInsetsState, textOf } from "./screenHarness";

const client = createMobileAuthClient({
  backendUrl: TEST_BACKEND_URL,
  storage: createMemorySecureStore(),
  fetchImplementation: createFakeBackend().fetchImplementation,
});

const emailEntry = () => createElement(EmailEntryScreen, { client, onCodeSent: () => undefined });
const codeEntry = () =>
  createElement(CodeEntryScreen, { client, email: "member@example.test", onSignedIn: () => undefined, onBack: () => undefined });
const signedIn = () =>
  createElement(SignedInScreen, {
    onSignOut: () => undefined,
    onExportData: () => Promise.resolve({ ok: true, json: "{}" } as const),
    onRequestDeleteCode: () => Promise.resolve({ ok: true } as const),
    onDeleteAccount: () => Promise.resolve({ ok: true } as const),
    onAccountDeleted: () => undefined,
    onReadAgeConfirmation: () => Promise.resolve({ ok: true, status: { age16Confirmed: true, age18Confirmed: false, canPurchase: false } } as const),
    onConfirmAdult: () => Promise.resolve({ ok: true, status: { age16Confirmed: true, age18Confirmed: true, canPurchase: true } } as const),
  });
const deleteCodeStep = () =>
  createElement(DeleteAccountCodeStep, {
    onRequestDeleteCode: () => Promise.resolve({ ok: true } as const),
    onDeleteAccount: () => Promise.resolve({ ok: true } as const),
    onAccountDeleted: () => undefined,
    onCancel: () => undefined,
  });
const screens: [string, () => ReactElement][] = [
  ["email entry", emailEntry],
  ["code entry", codeEntry],
  ["signed in", signedIn],
  ["delete code step", deleteCodeStep],
];

const renderReadyEmailEntry = async () => {
  const screen = await renderScreen(emailEntry());
  await screen.pressRole("checkbox");
  await screen.changeText("Email", "member@example.test");
  return screen;
};

describe.each(screens)("%s screen design", (_name, build) => {
  afterEach(() => {
    Platform.OS = "android";
    safeAreaInsetsState.bottom = 0;
    resetKeyboardListeners();
  });

  it("gives every tappable element and field at least a 48dp target, and every button a full pill shape", async () => {
    const screen = await renderScreen(build());
    for (const pressable of screen.pressables()) {
      expect(flattenStyle(pressable.props.style).minHeight, textOf(pressable)).toBeGreaterThanOrEqual(sizes.minTapTarget);
      if (pressable.props.accessibilityRole === "button") {
        expect(flattenStyle(pressable.props.style).borderRadius, textOf(pressable)).toBe(radius.pill);
      }
    }
    for (const input of screen.findAllByType("TextInput")) {
      expect(flattenStyle(input.props.style)).toMatchObject({
        minHeight: 48,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: radius.input,
        backgroundColor: colours.surfaceRaised,
        borderWidth: 1,
        borderColor: colours.border,
        color: colours.textPrimary,
      });
    }
  });

  it("uses lime only for at most one primary pill, never for text, and never white on lime", async () => {
    const screen = await renderScreen(build());
    const limePills = screen.pressables().filter((pressable) => flattenStyle(pressable.props.style).backgroundColor === colours.primary);
    expect(limePills.length).toBeLessThanOrEqual(1);
    for (const text of screen.findAllByType("Text")) {
      expect(flattenStyle(text.props.style).color, textOf(text)).not.toBe(colours.primary);
    }
    for (const pill of limePills) {
      for (const text of pill.children.filter((child) => typeof child !== "string" && child.type === "Text")) {
        expect(typeof text !== "string" && flattenStyle(text.props.style).color).toBe(colours.onPrimary);
      }
    }
  });

  it("sits top-aligned on the dark background in a keyboard-avoiding scroll view that keeps taps working", async () => {
    const screen = await renderScreen(build());
    expect(screen.findAllByType("KeyboardAvoidingView")).toHaveLength(1);
    const [scrollView] = screen.findAllByType("ScrollView");
    expect(scrollView?.props.keyboardShouldPersistTaps).toBe("handled");
    const content = flattenStyle(scrollView?.props.contentContainerStyle);
    expect(content).toMatchObject({ backgroundColor: colours.background, paddingHorizontal: 16, paddingTop: 24, gap: 16 });
    expect(content.justifyContent).toBeUndefined();
  });

  it("keeps content inside the safe-area-context SafeAreaView on both platforms, not RN's deprecated built-in", async () => {
    const screen = await renderScreen(build());
    const [safeArea, ...extra] = screen.findAllByType("SafeAreaContextView");
    expect(extra).toHaveLength(0);
    expect(flattenStyle(safeArea?.props.style)).toMatchObject({ flex: 1, backgroundColor: colours.background });
    // The bottom edge is padded inside the scroll view instead, so content can scroll clear of the nav bar.
    expect(safeArea?.props.edges).toEqual(["top", "left", "right"]);
    expect(screen.findAllByType("SafeAreaView")).toHaveLength(0);
  });

  it("keeps the last button above the Android nav bar / iOS home indicator: bottom padding = bottom inset + 24", async () => {
    safeAreaInsetsState.bottom = 48;
    const screen = await renderScreen(build());
    expect(flattenStyle(screen.findAllByType("ScrollView")[0]?.props.contentContainerStyle).paddingBottom).toBe(48 + 24);
    safeAreaInsetsState.bottom = 0;
    const flat = await renderScreen(build());
    expect(flattenStyle(flat.findAllByType("ScrollView")[0]?.props.contentContainerStyle).paddingBottom).toBe(24);
  });

  it("on iOS leaves a 24 gap above the open keyboard, without the home-indicator inset", async () => {
    Platform.OS = "ios";
    safeAreaInsetsState.bottom = 34;
    const screen = await renderScreen(build());
    const paddingBottom = () => flattenStyle(screen.findAllByType("ScrollView")[0]?.props.contentContainerStyle).paddingBottom;
    expect(paddingBottom()).toBe(34 + 24);

    emitKeyboardEvent("keyboardWillShow");
    await screen.rerender();
    expect(paddingBottom()).toBe(24);

    emitKeyboardEvent("keyboardWillHide");
    await screen.rerender();
    expect(paddingBottom()).toBe(34 + 24);
  });

  it("moves content above the keyboard on both platforms (Android: height, iOS: padding) and lets a drag close it", async () => {
    const android = await renderScreen(build());
    expect(android.findAllByType("KeyboardAvoidingView")[0]?.props.behavior).toBe("height");
    expect(android.findAllByType("ScrollView")[0]?.props.keyboardDismissMode).toBe("on-drag");
    Platform.OS = "ios";
    const ios = await renderScreen(build());
    expect(ios.findAllByType("KeyboardAvoidingView")[0]?.props.behavior).toBe("padding");
  });

  it("gives pressed buttons visible feedback (scale 0.98)", async () => {
    const screen = await renderScreen(build());
    for (const pressable of screen.pressables().filter((node) => node.props.accessibilityRole === "button")) {
      expect(flattenStyle(pressable.props.style, true).transform, textOf(pressable)).toEqual([{ scale: 0.98 }]);
      expect(flattenStyle(pressable.props.style, false).transform).toBeUndefined();
    }
  });

  it("uses body 15/22 for body copy and Display 28/34 bold for the screen title", async () => {
    const screen = await renderScreen(build());
    const [title] = screen.findAllByType("Text").filter((text) => text.props.accessibilityRole === "header");
    expect(flattenStyle(title?.props.style)).toMatchObject({ fontSize: 28, lineHeight: 34, fontWeight: "700", color: colours.textPrimary });
    const sizesUsed = new Set(screen.findAllByType("Text").map((text) => flattenStyle(text.props.style).fontSize));
    expect([...sizesUsed].every((size) => [12, 13, 15, 20, 28].includes(size as number))).toBe(true);
  });
});

describe("email entry design details", () => {
  it("shows the hero title, a muted 'create your account' subtitle, and a visible Label above the email field", async () => {
    const screen = await renderScreen(emailEntry());
    expect(screen.queryByText("Sign in to BJJ Roll")?.props.accessibilityRole).toBe("header");
    expect(flattenStyle(screen.queryByText("New here? We'll create your account.")?.props.style).color).toBe(colours.textSecondary);
    const label = screen.findAllByType("Text").find((text) => textOf(text) === "Email");
    expect(flattenStyle(label?.props.style)).toMatchObject({ fontSize: 13, lineHeight: 18, fontWeight: "500" });
  });

  it("makes the whole 16+ row (box and label) one 48dp target with a 24pt, 2pt-bordered box that fills lime when ticked", async () => {
    const screen = await renderScreen(emailEntry());
    const row = screen.getByRole("checkbox");
    expect(textOf(row)).toContain("I am 16 or older");
    expect(flattenStyle(row.props.style).minHeight).toBeGreaterThanOrEqual(48);
    const box = () => screen.findAllByType("View").find((view) => flattenStyle(view.props.style).width === 24);
    expect(flattenStyle(box()?.props.style)).toMatchObject({ height: 24, borderWidth: 2, borderColor: colours.textSecondary });

    await screen.pressRole("checkbox");
    expect(flattenStyle(box()?.props.style)).toMatchObject({ backgroundColor: colours.primary, borderColor: colours.primary });
    const tick = box()?.children.find((child) => typeof child !== "string" && child.type === "Text");
    expect(tick && typeof tick !== "string" && flattenStyle(tick.props.style).color).toBe(colours.onPrimary);
  });

  it("gives the checkbox an explicit screen-reader label and hides the ✓ glyph from screen readers", async () => {
    const screen = await renderScreen(emailEntry());
    expect(screen.getByRole("checkbox").props.accessibilityLabel).toBe("I am 16 or older");
    await screen.pressRole("checkbox");
    const tick = screen.findAllByType("Text").find((text) => textOf(text) === "✓");
    expect(tick?.props).toMatchObject({ accessibilityElementsHidden: true, importantForAccessibility: "no" });
  });

  it("turns the link action into a surface-2 secondary pill with a white label", async () => {
    const screen = await renderReadyEmailEntry();
    expect(flattenStyle(screen.getPressable("Email me a sign-in link instead").props.style)).toMatchObject({
      backgroundColor: colours.surfaceRaised,
      minHeight: 48,
      borderRadius: radius.pill,
    });
    expect(flattenStyle(screen.queryByText("Email me a sign-in link instead")?.props.style).color).toBe(colours.textPrimary);
    expect(flattenStyle(screen.getPressable("Continue").props.style)).toMatchObject({ minHeight: 56, backgroundColor: colours.primary });
  });

  it("shows the sent-link notice on a 16-radius surface card with a mail glyph hidden from screen readers", async () => {
    const screen = await renderReadyEmailEntry();
    await screen.press("Email me a sign-in link instead");
    const card = screen.findAllByType("View").find((view) => textOf(view).startsWith("✉") && flattenStyle(view.props.style).borderRadius === 16);
    expect(flattenStyle(card?.props.style)).toMatchObject({ backgroundColor: colours.surface, padding: 16 });
    expect(screen.queryByText("✉")?.props).toMatchObject({ accessibilityElementsHidden: true, importantForAccessibility: "no" });
  });
});

describe("code entry design details", () => {
  it("shows a visible Label for the code field and a muted expiry caption", async () => {
    const screen = await renderScreen(codeEntry());
    const label = screen.findAllByType("Text").find((text) => textOf(text) === "6-digit code");
    expect(flattenStyle(label?.props.style)).toMatchObject({ fontSize: 13, fontWeight: "500" });
    expect(flattenStyle(screen.queryByText("Code expires in 10 minutes.")?.props.style).color).toBe(colours.textSecondary);
    // A blocked secondary pill has no fill and a muted label, so it reads clearly as "not yet" next to an active one.
    expect(flattenStyle(screen.getPressable("Resend in 0:30").props.style)).toMatchObject({
      backgroundColor: "transparent",
      borderRadius: radius.pill,
    });
    expect(flattenStyle(screen.queryByText("Resend in 0:30")?.props.style).color).toBe(colours.textSecondary);
    expect(flattenStyle(screen.getPressable("Use a different email").props.style).backgroundColor).toBeUndefined();
  });
});
