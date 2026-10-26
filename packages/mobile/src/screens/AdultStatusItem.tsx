import { type ComponentRef, type Ref, useEffect, useRef } from "react";
import { AccessibilityInfo, Platform, StyleSheet, Text, View } from "react-native";
import { sizes, spacing, textStyles } from "../theme/tokens";
import { AuthButton } from "./AuthButton";

/** The 18+ answer: unknown while the read runs, "failed" when it could not be read (then the button shows anyway). */
export type AdultStatus = "checking" | "failed" | boolean;

export interface AdultStatusItemProps {
  readonly status: AdultStatus;
  /** Screen reader focus returns here when the confirm dialog is cancelled. */
  readonly buttonRef: Ref<View>;
  /** True only right after this visit's confirm saved: focus moves to the confirmed row and it is announced once (Vera delta item 1). */
  readonly announceConfirmed: boolean;
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
export function AdultStatusItem({ status, buttonRef, announceConfirmed, disabled, loading, onConfirmPress }: AdultStatusItemProps) {
  const announce = announceConfirmed && status === true;
  const confirmedRow = useRef<ComponentRef<typeof View>>(null);
  // Same as StatusText: Android hears the polite live region, iOS (which ignores live regions) gets one announcement.
  useEffect(() => {
    if (!announce) {
      return;
    }
    if (confirmedRow.current) {
      AccessibilityInfo.sendAccessibilityEvent(confirmedRow.current, "focus");
    }
    if (Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility(ADULT_CONFIRMED_TEXT);
    }
  }, [announce]);

  if (status === "checking") {
    return (
      <View style={styles.statusRow}>
        <Text style={textStyles.bodyMuted}>Checking…</Text>
      </View>
    );
  }
  if (status === true) {
    return (
      <View ref={confirmedRow} accessible accessibilityLiveRegion={announce ? "polite" : undefined} style={styles.statusRow}>
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
