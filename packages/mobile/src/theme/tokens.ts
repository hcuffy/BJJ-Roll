import { StyleSheet } from "react-native";

export const colours = {
  background: "#111313",
  surface: "#1C1D1C",
  surfaceRaised: "#262826",
  textPrimary: "#FFFFFF",
  textSecondary: "#A0A3A0",
  primary: "#E0F154",
  onPrimary: "#111313",
  border: "#7A7D7A",
  danger: "#FF6B4A",
} as const;

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
