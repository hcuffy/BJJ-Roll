import { type ComponentRef, type Ref, useEffect, useRef } from "react";
import { AccessibilityInfo, StyleSheet, Text, View } from "react-native";
import { sizes, spacing, textStyles } from "../theme/tokens";
import { AuthButton } from "./AuthButton";

/** The 18+ answer: unknown while the read runs, "failed" when it could not be read (then the button shows anyway). */
export type AdultStatus = "checking" | "failed" | boolean;

export interface AdultStatusItemProps {
  readonly status: AdultStatus;
  /** Screen reader focus returns here when the confirm dialog is cancelled. */
  readonly buttonRef: Ref<View>;
  /** True only right after this visit's confirm saved: focus moves to the confirmed row once (Vera delta item 1). */
  readonly focusConfirmedRow: boolean;
  /** Called after that focus move, so the flag is cleared on first use and a later remount does not move focus again. */
  readonly onConfirmedRowFocused: () => void;
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

export const ADULT_CONFIRMED_TEXT = "18 or older: confirmed";

/** Account section 18+ slot (HEN-263): "Checking…", the confirmed row, or the confirm button with its can't-undo line. */
export function AdultStatusItem(props: AdultStatusItemProps) {
  const { status, buttonRef, focusConfirmedRow, onConfirmedRowFocused, disabled, loading, onConfirmPress } = props;
  const moveFocus = focusConfirmedRow && status === true;
  const confirmedRow = useRef<ComponentRef<typeof View>>(null);
  // The focus move alone reads the row once on both platforms; no live region or iOS announcement on top (Vera round 4 item 2).
  useEffect(() => {
    if (!moveFocus) {
      return;
    }
    if (confirmedRow.current) {
      AccessibilityInfo.sendAccessibilityEvent(confirmedRow.current, "focus");
    }
    onConfirmedRowFocused();
  }, [moveFocus, onConfirmedRowFocused]);

  if (status === "checking") {
    return (
      <View style={styles.statusRow}>
        <Text style={textStyles.bodyMuted}>Checking…</Text>
      </View>
    );
  }
  if (status === true) {
    return (
      <View ref={confirmedRow} accessible style={styles.statusRow}>
        <Text style={textStyles.bodyMuted} accessibilityElementsHidden importantForAccessibility="no">
          ✓
        </Text>
        <Text style={textStyles.bodyMuted}>{ADULT_CONFIRMED_TEXT}</Text>
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
        accessibilityHint="Asks you to confirm first. Needed for buying later."
        onPress={onConfirmPress}
      />
      <Text style={textStyles.bodyMuted}>You can&apos;t undo this, except by deleting your account.</Text>
    </View>
  );
}
