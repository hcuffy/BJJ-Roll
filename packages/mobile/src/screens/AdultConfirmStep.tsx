import { type ComponentRef, useEffect, useRef } from "react";
import { AccessibilityInfo, Text, View } from "react-native";
import { textStyles } from "../theme/tokens";
import { AuthButton } from "./AuthButton";
import { AuthScreenLayout } from "./AuthScreenLayout";
import { authStyles } from "./authStyles";

export interface AdultConfirmStepProps {
  /** Writes the 18+ record; called at most once per opening. */
  readonly onConfirm: () => void;
  /** Closes the dialog; nothing is written. */
  readonly onCancel: () => void;
}

/** Confirm dialog before the 18+ record is written (Henry, HEN-263): same in-screen pattern as "Delete your account?". */
export function AdultConfirmStep({ onConfirm, onCancel }: AdultConfirmStepProps) {
  const heading = useRef<ComponentRef<typeof Text>>(null);

  // Acts as a dialog: screen reader focus moves to its heading when it opens.
  useEffect(() => {
    if (heading.current) {
      AccessibilityInfo.sendAccessibilityEvent(heading.current, "focus");
    }
  }, []);

  return (
    <AuthScreenLayout>
      <Text accessibilityRole="header" style={textStyles.display}>
        You are signed in
      </Text>
      <View style={authStyles.heading}>
        <Text ref={heading} accessibilityRole="header" style={textStyles.title}>
          Confirm you are 18 or older?
        </Text>
        <Text style={textStyles.body}>You can&apos;t undo this, except by deleting your account.</Text>
        <Text style={textStyles.bodyMuted}>Needed for buying later.</Text>
      </View>
      <View style={authStyles.actions}>
        <AuthButton title="Yes, I am 18 or older" variant="primary" accessibilityHint="Records that you are 18 or older." onPress={onConfirm} />
        <AuthButton title="Cancel" variant="tertiary" accessibilityHint="Nothing is recorded." onPress={onCancel} />
      </View>
    </AuthScreenLayout>
  );
}
