import type { Ref } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, type View } from "react-native";
import { colours, radius, sizes, spacing, typeScale } from "../theme/tokens";

export interface AuthButtonProps {
  readonly title: string;
  readonly onPress: () => void;
  /**
   * primary: the one lime pill per screen. secondary: surface-2 pill. tertiary: text-only, still 48dp tall.
   * danger: red-orange pill with a dark text label, only for the confirm step of a destructive action (deletes or loses data).
   * dangerText: tertiary with a red-orange label, the entry point to a destructive action.
   */
  readonly variant?: "primary" | "secondary" | "tertiary" | "danger" | "dangerText";
  readonly disabled?: boolean;
  /** Looks disabled but stays pressable (and is announced as enabled), so a tap can explain what is missing. */
  readonly looksDisabled?: boolean;
  /** Shows a spinner and `loadingTitle` in the same-size pill, and blocks presses. */
  readonly loading?: boolean;
  readonly loadingTitle?: string;
  readonly accessibilityHint?: string;
  /** For moving screen-reader focus to the button. */
  readonly ref?: Ref<View>;
}

const styles = StyleSheet.create({
  base: {
    minHeight: sizes.minTapTarget,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.large,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.small,
  },
  primary: { minHeight: sizes.buttonHeight, backgroundColor: colours.primary },
  secondary: { backgroundColor: colours.surfaceRaised },
  tertiary: {},
  danger: { minHeight: sizes.buttonHeight, backgroundColor: colours.danger },
  dangerText: {},
  dimmed: { backgroundColor: colours.surfaceRaised },
  // A blocked secondary pill (e.g. "Resend in 0:30") drops its fill, so it reads as "not yet" next to an active one.
  blockedSecondary: { backgroundColor: "transparent" },
  pressed: { transform: [{ scale: 0.98 }] },
  label: { ...typeScale.body, fontWeight: "600", textAlign: "center", color: colours.textPrimary },
  labelOnPrimary: { color: colours.onPrimary },
  labelDanger: { color: colours.danger },
  labelDimmed: { color: colours.textSecondary },
});

export function AuthButton({
  title,
  onPress,
  variant = "primary",
  disabled = false,
  looksDisabled = false,
  loading = false,
  loadingTitle,
  accessibilityHint,
  ref,
}: AuthButtonProps) {
  const blocked = disabled || loading;
  // While loading the pill keeps its fill; otherwise disabled is shown by fill and label colour, not opacity.
  const dimmed = !loading && (disabled || looksDisabled);
  // Primary (lime) and danger (red-orange) fills both take the dark label.
  const onPrimary = (variant === "primary" || variant === "danger") && !dimmed;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: blocked, busy: loading }}
      accessibilityHint={accessibilityHint}
      disabled={blocked}
      onPress={onPress}
      ref={ref}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        dimmed && variant !== "tertiary" && variant !== "dangerText" && styles.dimmed,
        disabled && !loading && variant === "secondary" && styles.blockedSecondary,
        pressed && styles.pressed,
      ]}>
      {loading ? <ActivityIndicator size="small" color={onPrimary ? colours.onPrimary : colours.textPrimary} /> : null}
      <Text style={[styles.label, onPrimary && styles.labelOnPrimary, variant === "dangerText" && styles.labelDanger, dimmed && styles.labelDimmed]}>
        {loading ? (loadingTitle ?? title) : title}
      </Text>
    </Pressable>
  );
}
