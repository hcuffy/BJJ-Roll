import { type ComponentRef, type Ref, useEffect, useRef } from "react";
import { AccessibilityInfo, StyleSheet, Text, View } from "react-native";
import { sizes, spacing, textStyles } from "../theme/tokens";
import { AuthButton } from "./AuthButton";

export type AdultStatus = "checking" | "failed" | boolean;

export interface AdultStatusItemProps {
  readonly status: AdultStatus;
  readonly buttonRef: Ref<View>;
  readonly focusConfirmedRow: boolean;
  readonly onConfirmedRowFocused: () => void;
  readonly disabled: boolean;
  readonly loading: boolean;
  readonly onConfirmPress: () => void;
}

const styles = StyleSheet.create({
  statusRow: { minHeight: sizes.minTapTarget, paddingHorizontal: spacing.large, flexDirection: "row", alignItems: "center", gap: spacing.small },
  adultItem: { gap: spacing.small },
});

export const ADULT_CONFIRMED_TEXT = "18 or older: confirmed";

export function AdultStatusItem(props: AdultStatusItemProps) {
  const { status, buttonRef, focusConfirmedRow, onConfirmedRowFocused, disabled, loading, onConfirmPress } = props;
  const moveFocus = focusConfirmedRow && status === true;
  const confirmedRow = useRef<ComponentRef<typeof View>>(null);
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
