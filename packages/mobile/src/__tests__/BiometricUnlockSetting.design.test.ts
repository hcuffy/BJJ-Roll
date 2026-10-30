import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { BiometricCheck, BiometricSetting } from "../auth/biometricUnlock";
import { BiometricUnlockSetting } from "../screens/BiometricUnlockSetting";
import { colours, sizes } from "../theme/tokens";
import { flattenStyle, renderScreen } from "./screenHarness";

const SET_UP_NOTE = "Add a fingerprint or face in your phone's Settings to use this.";

const renderToggle = async (setting: BiometricSetting) => {
  const onChangeBiometricUnlock = vi.fn((): Promise<BiometricCheck> => Promise.resolve({ ok: true }));
  const screen = await renderScreen(
    createElement(BiometricUnlockSetting, {
      setting,
      onSettingChanged: () => undefined,
      onChangeBiometricUnlock,
      error: null,
      onErrorChanged: () => undefined,
      onChangeStarted: () => undefined,
    }),
  );
  return { screen, onChangeBiometricUnlock };
};

/** WCAG relative-luminance contrast ratio of two #RRGGBB colours. */
function contrast(first: string, second: string): number {
  const luminance = (hex: string) => {
    const linear = (start: number) => {
      const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
      return channel <= 0.039_28 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * linear(1) + 0.7152 * linear(3) + 0.0722 * linear(5);
  };
  const [one, two] = [luminance(first), luminance(second)];
  return (Math.max(one, two) + 0.05) / (Math.min(one, two) + 0.05);
}

describe("BiometricUnlockSetting design (Vera round 2)", () => {
  it("fix 4: the whole row is one switch, named by its visible label, and a tap anywhere on it toggles", async () => {
    const { screen, onChangeBiometricUnlock } = await renderToggle({ available: true, on: false, kind: "biometrics" });
    const row = screen.getByRole("switch");

    expect(row.props.accessibilityLabel).toBe("Biometric unlock");
    expect(row.props.accessibilityState).toMatchObject({ checked: false, disabled: false });
    expect(flattenStyle(row.props.style).minHeight).toBeGreaterThanOrEqual(sizes.minTapTarget);
    // The inner label and Switch are not second stops for TalkBack or VoiceOver.
    const [innerSwitch] = screen.findAllByType("Switch");
    expect(innerSwitch?.props).toMatchObject({ importantForAccessibility: "no-hide-descendants", accessibilityElementsHidden: true });
    expect(screen.queryByText("Biometric unlock")?.props).toMatchObject({ importantForAccessibility: "no", accessibilityElementsHidden: true });

    await screen.press("Biometric unlock");
    expect(onChangeBiometricUnlock).toHaveBeenCalledWith(true);
  });

  it("fix 5: when nothing is enrolled the disabled switch's hint says how to set it up", async () => {
    const { screen, onChangeBiometricUnlock } = await renderToggle({ available: false, kind: "biometrics" });
    const row = screen.getByRole("switch");

    expect(row.props.accessibilityState).toMatchObject({ checked: false, disabled: true });
    expect(row.props.accessibilityHint).toBe(SET_UP_NOTE);
    expect(screen.text()).toContain(SET_UP_NOTE);
    await screen.press("Biometric unlock");
    expect(onChangeBiometricUnlock).not.toHaveBeenCalled();
  });

  it("fix 6: a dark thumb on the lime track, and an off track with 3:1 contrast on the background", async () => {
    const on = (await renderToggle({ available: true, on: true, kind: "biometrics" })).screen.findAllByType("Switch")[0];
    const off = (await renderToggle({ available: true, on: false, kind: "biometrics" })).screen.findAllByType("Switch")[0];
    const onProps = on?.props as { thumbColor: string; trackColor: { true: string; false: string } };
    const offProps = off?.props as { thumbColor: string; trackColor: { false: string }; ios_backgroundColor: string };

    expect(onProps.thumbColor).toBe(colours.background);
    expect(contrast(onProps.thumbColor, onProps.trackColor.true)).toBeGreaterThanOrEqual(3);
    expect(contrast(offProps.trackColor.false, colours.background)).toBeGreaterThanOrEqual(3);
    expect(offProps.ios_backgroundColor).toBe(offProps.trackColor.false);
    expect(contrast(offProps.thumbColor, offProps.trackColor.false)).toBeGreaterThanOrEqual(3);
  });
});
