import { StyleSheet } from "react-native";

// Design tokens from Vera's style guide v0 (approved 2026-10-22): dark base, one lime accent, dark text on lime.
// Contrast pairs are checked in src/__tests__/theme.tokens.test.ts.

export const colours = {
  background: "#111313",
  surface: "#1C1D1C",
  /** "surface-2" in the style guide: raised fills such as inputs and secondary pills. */
  surfaceRaised: "#262826",
  textPrimary: "#FFFFFF",
  textSecondary: "#A0A3A0",
  /** Lime: only the single primary pill, focus rings and the ticked checkbox. Never text. */
  primary: "#E0F154",
  onPrimary: "#111313",
  /** Input and control edges; 4.48:1 on the background, so above the 3:1 non-text minimum. */
  border: "#7A7D7A",
  danger: "#FF6B4A",
} as const;

/** 4pt grid. */
export const spacing = {
  extraSmall: 4,
  small: 8,
  medium: 16,
  large: 24,
  extraLarge: 32,
} as const;

export const typeScale = {
  caption: { fontSize: 12, lineHeight: 16 },
  label: { fontSize: 13, lineHeight: 18 },
  body: { fontSize: 15, lineHeight: 22 },
  title: { fontSize: 20, lineHeight: 26 },
  display: { fontSize: 28, lineHeight: 34 },
} as const;

export const radius = {
  input: 12,
  card: 16,
  pill: 999,
} as const;

export const sizes = {
  /** Smallest tap target on any platform (Android 48dp; iOS asks for 44pt). */
  minTapTarget: 48,
  buttonHeight: 56,
  checkbox: 24,
} as const;

export const textStyles = StyleSheet.create({
  caption: { ...typeScale.caption, color: colours.textSecondary },
  label: { ...typeScale.label, fontWeight: "500", color: colours.textPrimary },
  body: { ...typeScale.body, color: colours.textPrimary },
  bodyMuted: { ...typeScale.body, color: colours.textSecondary },
  title: { ...typeScale.title, fontWeight: "600", color: colours.textPrimary },
  display: { ...typeScale.display, fontWeight: "700", color: colours.textPrimary },
});
