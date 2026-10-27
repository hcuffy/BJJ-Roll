import { createElement } from "react";
import { AppleAuthenticationButtonStyle, AppleAuthenticationButtonType } from "expo-apple-authentication";
import { Platform } from "react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SocialProvider } from "../auth/socialSignIn";
import { type SocialSignInButtonsProps, SocialSignInButtons } from "../screens/SocialSignInButtons";
import { flattenStyle, renderScreen, textOf } from "./screenHarness";
import appConfig from "../../app.json";

const TICK_16_HINT = "Tick the 16 or older box first.";

async function renderButtons(overrides: Partial<SocialSignInButtonsProps> = {}) {
  const onPress = vi.fn<(provider: SocialProvider) => void>();
  const props: SocialSignInButtonsProps = { providers: ["google"], age16Confirmed: true, sending: null, onPress, ...overrides };
  const screen = await renderScreen(createElement(SocialSignInButtons, props));
  return { screen, onPress };
}

describe("HEN-239 brand sign-in buttons (Google dark theme, Apple's own button)", () => {
  afterEach(() => {
    Platform.OS = "android";
  });

  it("Google: dark pill per Google's guidelines, 56 tall, with the colour G hidden from screen readers", async () => {
    const { screen } = await renderButtons();
    const button = screen.getPressable("Continue with Google");

    expect(button.props.accessibilityRole).toBe("button");
    expect(button.props.accessibilityLabel).toBe("Continue with Google");
    expect(flattenStyle(button.props.style)).toMatchObject({
      backgroundColor: "#131314",
      borderColor: "#8E918F",
      borderWidth: 1,
      minHeight: 56,
      borderRadius: 999,
      paddingHorizontal: 12,
      gap: 10,
    });
    const [logo] = screen.findAllByType("Image");
    expect(String(logo?.props.source)).toMatch(/google-g\.png$/u);
    expect(flattenStyle(logo?.props.style)).toMatchObject({ width: 20, height: 20 });
    expect(logo?.props).toMatchObject({ accessible: false, accessibilityElementsHidden: true, importantForAccessibility: "no" });
    const label = screen.queryByText("Continue with Google");
    expect(flattenStyle(label?.props.style)).toMatchObject({ color: "#E3E3E3", fontSize: 14, lineHeight: 20, fontWeight: "500" });
  });

  it("without the 16+ tick the brand colours stay, a visible line and the hint say why, and a tap still explains", async () => {
    const unticked = await renderButtons({ age16Confirmed: false });
    const ticked = await renderButtons({ age16Confirmed: true });
    const untickedButton = unticked.screen.getPressable("Continue with Google");

    expect(flattenStyle(untickedButton.props.style)).toEqual(flattenStyle(ticked.screen.getPressable("Continue with Google").props.style));
    expect(untickedButton.props.accessibilityHint).toBe(TICK_16_HINT);
    expect(untickedButton.props.disabled).not.toBe(true);
    expect(unticked.screen.queryByText(TICK_16_HINT)).not.toBeNull();
    await unticked.screen.press("Continue with Google");
    expect(unticked.onPress).toHaveBeenCalledWith("google");

    expect(ticked.screen.getPressable("Continue with Google").props.accessibilityHint).toBeUndefined();
    expect(ticked.screen.queryByText(TICK_16_HINT)).toBeNull();
  });

  it("Google: busy while it signs in, and disabled (announced) while another sign-in runs", async () => {
    const busy = (await renderButtons({ sending: "google" })).screen.getPressable("Opening Google…");
    expect(busy.props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(busy.props.accessibilityLabel).toBe("Opening Google…");

    const { screen, onPress } = await renderButtons({ sending: "code" });
    expect(screen.getPressable("Continue with Google").props.accessibilityState).toEqual({ disabled: true, busy: false });
    await screen.press("Continue with Google");
    expect(onPress).not.toHaveBeenCalled();
  });

  it("Apple on iOS: Apple's native button (Continue, white, pill, 56 tall), the same 16+ hint, before Google", async () => {
    Platform.OS = "ios";
    const { screen, onPress } = await renderButtons({ providers: ["apple", "google"], age16Confirmed: false });
    const [apple] = screen.findAllByType("AppleAuthenticationButton");

    expect(apple?.props).toMatchObject({
      buttonType: AppleAuthenticationButtonType.CONTINUE,
      buttonStyle: AppleAuthenticationButtonStyle.WHITE,
      cornerRadius: 28,
      accessibilityHint: TICK_16_HINT,
    });
    expect(flattenStyle(apple?.props.style)).toMatchObject({ height: 56 });
    expect(screen.pressables().indexOf(apple!)).toBeLessThan(screen.pressables().indexOf(screen.getPressable("Continue with Google")));
    (apple?.props.onPress as () => void)();
    expect(onPress).toHaveBeenCalledWith("apple");
  });

  it("Apple on iOS ignores a tap while another sign-in runs", async () => {
    Platform.OS = "ios";
    const { screen, onPress } = await renderButtons({ providers: ["apple"], sending: "code" });
    const [apple] = screen.findAllByType("AppleAuthenticationButton");

    expect(apple?.props.accessibilityState).toEqual({ disabled: true, busy: false });
    (apple?.props.onPress as () => void)();
    expect(onPress).not.toHaveBeenCalled();
  });

  it("Apple elsewhere (browser flow): a white HIG pill with a black title, 56 tall, no recoloured Apple logo", async () => {
    const { screen } = await renderButtons({ providers: ["apple"] });
    const button = screen.getPressable("Continue with Apple");

    expect(button.props.accessibilityLabel).toBe("Continue with Apple");
    expect(flattenStyle(button.props.style)).toMatchObject({ backgroundColor: "#FFFFFF", minHeight: 56, borderRadius: 999 });
    const title = screen.queryByText("Continue with Apple");
    expect(flattenStyle(title?.props.style)).toMatchObject({ color: "#000000" });
    expect(screen.findAllByType("Image")).toHaveLength(0);
    expect(textOf(button)).toBe("Continue with Apple");
  });

  it("the shipped app keeps Apple off", () => {
    expect(appConfig.expo.extra.socialSignIn.appleEnabled).toBe(false);
  });
});
