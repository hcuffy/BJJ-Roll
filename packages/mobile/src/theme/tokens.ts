import { StyleSheet } from "react-native";

// Design tokens for the mobile app (ARCHITECTURE.md §8: @expo/ui with our own tokens on plain StyleSheet).
// Starting values only; screens and components that use them come in later issues.

export const colours = {
  background: "#FFFFFF",
  surface: "#F4F5F7",
  textPrimary: "#111418",
  textSecondary: "#5B6470",
  primary: "#1F4FD1",
  onPrimary: "#FFFFFF",
  border: "#D9DDE3",
  success: "#1E7F4F",
  warning: "#B26A00",
  danger: "#C62828",
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
  body: { fontSize: 16, lineHeight: 24 },
  subtitle: { fontSize: 18, lineHeight: 26 },
  title: { fontSize: 22, lineHeight: 28 },
  headline: { fontSize: 28, lineHeight: 34 },
} as const;

export const textStyles = StyleSheet.create({
  caption: { ...typeScale.caption, color: colours.textSecondary },
  body: { ...typeScale.body, color: colours.textPrimary },
  subtitle: { ...typeScale.subtitle, fontWeight: "600", color: colours.textPrimary },
  title: { ...typeScale.title, fontWeight: "700", color: colours.textPrimary },
  headline: { ...typeScale.headline, fontWeight: "700", color: colours.textPrimary },
});
