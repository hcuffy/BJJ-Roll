import type { Ref } from "react";
import { StyleSheet, Text, View } from "react-native";
import { sizes, spacing, textStyles } from "../theme/tokens";
import { AuthButton } from "./AuthButton";

/** The 18+ answer: unknown while the read runs, "failed" when it could not be read (then the button shows anyway). */
export type AdultStatus = "checking" | "failed" | boolean;

export interface AdultStatusItemProps {
  readonly status: AdultStatus;
  /** Screen reader focus returns here when the confirm dialog is cancelled. */
  readonly buttonRef: Ref<View>;
  readonly disabled: boolean;
  readonly loading: boolean;
  /** Opens the confirm dialog; nothing is written by this press. */
  readonly onConfirmPress: () => void;
}

const styles = StyleSheet.create({
  // Lines up with the pills: same 48 height and 24 side padding, so the slot does not jump when the read returns.
  statusRow: { minHeight: sizes.minTapTarget, paddingHorizontal: spacing.large, flexDirection: "row", alignItems: "center", gap: spacing.small },
  adultItem: { gap: spacing.small },
});

/** Account section 18+ slot (HEN-263): "Checking…", the confirmed row, or the confirm button with its can't-undo line. */
export function AdultStatusItem({ status, buttonRef, disabled, loading, onConfirmPress }: AdultStatusItemProps) {
  if (status === "checking") {
    return (
      <View style={styles.statusRow}>
        <Text style={textStyles.bodyMuted}>Checking…</Text>
      </View>
    );
  }
  if (status === true) {
    return (
      <View style={styles.statusRow}>
        <Text style={textStyles.bodyMuted} accessibilityElementsHidden importantForAccessibility="no">
          ✓
        </Text>
        <Text style={textStyles.bodyMuted}>18 or older: confirmed</Text>
      </View>
    );
  }
  return (
    <View style={styles.adultItem}>
      <AuthButton
        ref={buttonRef}
        title="Confirm I am 18 or older"
        variant="secondary"
        disabled={disabled}
        loading={loading}
        loadingTitle="Saving…"
        accessibilityHint="Records that you are 18 or older. Needed for buying later."
        onPress={onConfirmPress}
      />
      <Text style={textStyles.bodyMuted}>You can&apos;t undo this, except by deleting your account.</Text>
    </View>
  );
}
