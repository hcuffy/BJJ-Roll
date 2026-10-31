import { type ComponentRef, useEffect, useRef } from "react";
import { AccessibilityInfo, Text, View } from "react-native";
import { textStyles } from "../theme/tokens";
import { AuthButton } from "./AuthButton";
import { AuthScreenLayout } from "./AuthScreenLayout";
import { authStyles } from "./authStyles";

export interface AdultConfirmStepProps {
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function AdultConfirmStep({ onConfirm, onCancel }: AdultConfirmStepProps) {
  const heading = useRef<ComponentRef<typeof Text>>(null);

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
