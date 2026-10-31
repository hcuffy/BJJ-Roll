import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { colours, radius, sizes, spacing, typeScale } from "../theme/tokens";

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
  const [red, green, blue] = channels.map((value) => (value <= 0.040_45 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (red ?? 0) + 0.7152 * (green ?? 0) + 0.0722 * (blue ?? 0);
}

function contrast(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((first, second) => second - first);
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

describe("theme tokens (Vera's style guide v0)", () => {
  it("uses the approved dark base with the lime accent and dark text on lime", () => {
    expect(colours).toMatchObject({
      background: "#111313",
      surface: "#1C1D1C",
      surfaceRaised: "#262826",
      textPrimary: "#FFFFFF",
      textSecondary: "#A0A3A0",
      primary: "#E0F154",
      onPrimary: "#111313",
      border: "#7A7D7A",
      danger: "#FF6B4A",
    });
  });

  it("meets WCAG AA: 4.5:1 for text, 3:1 for input and checkbox edges", () => {
    expect(contrast(colours.textPrimary, colours.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colours.onPrimary, colours.primary)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colours.textSecondary, colours.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colours.textSecondary, colours.surfaceRaised)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colours.textPrimary, colours.surfaceRaised)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colours.danger, colours.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colours.danger, colours.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colours.onPrimary, colours.danger)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colours.border, colours.background)).toBeGreaterThanOrEqual(3);
    expect(contrast(colours.border, colours.surfaceRaised)).toBeGreaterThanOrEqual(3);
    expect(contrast(colours.textSecondary, colours.background)).toBeGreaterThanOrEqual(3);
    expect(contrast(colours.primary, colours.background)).toBeGreaterThanOrEqual(3);
  });

  it("follows the guide's type scale, 4pt spacing, radii and 48dp minimum tap size", () => {
    expect(typeScale.display).toEqual({ fontSize: 28, lineHeight: 34 });
    expect(typeScale.title).toEqual({ fontSize: 20, lineHeight: 26 });
    expect(typeScale.body).toEqual({ fontSize: 15, lineHeight: 22 });
    expect(typeScale.label).toEqual({ fontSize: 13, lineHeight: 18 });
    expect(typeScale.caption).toEqual({ fontSize: 12, lineHeight: 16 });
    expect(spacing.medium).toBe(16);
    expect(Object.values(spacing).every((value) => value % 4 === 0)).toBe(true);
    expect(radius).toMatchObject({ input: 12, card: 16, pill: 999 });
    expect(sizes.minTapTarget).toBe(48);
    expect(sizes.buttonHeight).toBe(56);
  });

  it("runs the app in dark interface style", () => {
    const appConfig = JSON.parse(readFileSync(new URL("../../app.json", import.meta.url), "utf8")) as {
      expo: { userInterfaceStyle?: string; backgroundColor?: string };
    };
    expect(appConfig.expo.userInterfaceStyle).toBe("dark");
    expect(appConfig.expo.backgroundColor).toBe(colours.background);
  });
});
