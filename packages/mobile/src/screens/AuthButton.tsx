import type { Ref } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, type View } from "react-native";
import { colours, radius, sizes, spacing, typeScale } from "../theme/tokens";

export interface AuthButtonProps {
  readonly title: string;
  readonly onPress: () => void;
  readonly variant?: "primary" | "secondary" | "tertiary" | "danger" | "dangerText";
  readonly disabled?: boolean;
  readonly looksDisabled?: boolean;
  readonly loading?: boolean;
  readonly loadingTitle?: string;
  readonly accessibilityHint?: string;
  readonly large?: boolean;
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
  large: { minHeight: sizes.buttonHeight },
  secondary: { backgroundColor: colours.surfaceRaised },
  tertiary: {},
  danger: { minHeight: sizes.buttonHeight, backgroundColor: colours.danger },
  dangerText: {},
  dimmed: { backgroundColor: colours.surfaceRaised },
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
  large = false,
  ref,
}: AuthButtonProps) {
  const blocked = disabled || loading;
  const dimmed = !loading && (disabled || looksDisabled);
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
        large && styles.large,
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
