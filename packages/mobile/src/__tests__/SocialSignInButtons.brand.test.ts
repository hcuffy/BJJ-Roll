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

  it("Google: Google's official dark pill button image, unedited, 56 tall at its own aspect ratio, centred, in one labelled button", async () => {
    const { screen } = await renderButtons();
    const button = screen.getPressable("Sign in with Google");

    expect(button.props.accessibilityRole).toBe("button");
    expect(button.props.accessibilityLabel).toBe("Sign in with Google");
    expect(flattenStyle(button.props.style)).toMatchObject({ alignSelf: "center" });
    expect(textOf(button)).toBe("");
    const images = screen.findAllByType("Image");
    expect(images).toHaveLength(1);
    expect(String(images[0]?.props.source)).toMatch(/google-sign-in-dark-pill\.png$/u);
    // The bundle's @1x is 180×40: 56 tall keeps that ratio (252 wide), so the image is never stretched.
    expect(flattenStyle(images[0]?.props.style)).toEqual({ height: 56, width: 252 });
    expect(images[0]?.props).toMatchObject({
      resizeMode: "contain",
      accessible: false,
      accessibilityElementsHidden: true,
      importantForAccessibility: "no",
    });
  });

  it("without the 16+ tick the brand colours stay, a visible line and the hint say why, and a tap still explains", async () => {
    const unticked = await renderButtons({ age16Confirmed: false });
    const ticked = await renderButtons({ age16Confirmed: true });
    const untickedButton = unticked.screen.getPressable("Sign in with Google");

    expect(flattenStyle(untickedButton.props.style)).toEqual(flattenStyle(ticked.screen.getPressable("Sign in with Google").props.style));
    expect(untickedButton.props.accessibilityHint).toBe(TICK_16_HINT);
    expect(untickedButton.props.disabled).not.toBe(true);
    expect(unticked.screen.queryByText(TICK_16_HINT)).not.toBeNull();
    await unticked.screen.press("Sign in with Google");
    expect(unticked.onPress).toHaveBeenCalledWith("google");

    expect(ticked.screen.getPressable("Sign in with Google").props.accessibilityHint).toBeUndefined();
    expect(ticked.screen.queryByText(TICK_16_HINT)).toBeNull();
  });

  it("Google: busy while it signs in, with the image unchanged; disabled (announced) while another sign-in runs", async () => {
    const { screen: busyScreen } = await renderButtons({ sending: "google" });
    const busy = busyScreen.getPressable("Sign in with Google");
    expect(busy.props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(String(busyScreen.findAllByType("Image")[0]?.props.source)).toMatch(/google-sign-in-dark-pill\.png$/u);
    expect(busyScreen.queryByText("Opening Google…")).not.toBeNull();
    // Vera delta item 3: the spinner is decoration; only the words are read (and announced politely).
    const [spinner, ...extraSpinners] = busyScreen.findAllByType("ActivityIndicator");
    expect(extraSpinners).toHaveLength(0);
    expect(spinner?.props).toMatchObject({ accessible: false, accessibilityElementsHidden: true, importantForAccessibility: "no" });

    const returned = (await renderButtons({ sending: "google", progress: "signingIn" })).screen;
    expect(returned.queryByText("Signing in…")).not.toBeNull();
    expect(returned.queryByText("Opening Google…")).toBeNull();

    const { screen, onPress } = await renderButtons({ sending: "code" });
    expect(screen.getPressable("Sign in with Google").props.accessibilityState).toEqual({ disabled: true, busy: false });
    expect(screen.queryByText("Opening Google…")).toBeNull();
    await screen.press("Sign in with Google");
    expect(onPress).not.toHaveBeenCalled();
  });

  it("order: 'or' divider, then the 16+ line, then the brand buttons, then a social error", async () => {
    const { screen } = await renderButtons({ age16Confirmed: false, error: "Couldn't sign in with Google. Try again." });
    const texts = screen.findAllByType("Text").map(textOf);

    expect(texts.indexOf("or")).toBeGreaterThanOrEqual(0);
    expect(texts.indexOf("or")).toBeLessThan(texts.indexOf(TICK_16_HINT));
    const all = screen.findAllByType("Text");
    const google = screen.getPressable("Sign in with Google");
    expect(all.length).toBeGreaterThan(2);
    expect(texts.at(-1)).toBe("Couldn't sign in with Google. Try again.");
    expect(google).toBeDefined();
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
    expect(screen.pressables().indexOf(apple!)).toBeLessThan(screen.pressables().indexOf(screen.getPressable("Sign in with Google")));
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
