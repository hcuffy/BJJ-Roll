import { AppleAuthenticationButton, AppleAuthenticationButtonStyle, AppleAuthenticationButtonType } from "expo-apple-authentication";
import { StyleSheet } from "react-native";
import { sizes } from "../theme/tokens";
import type { BrandButtonProps } from "./brandButtonProps";

const styles = StyleSheet.create({
  native: { height: sizes.buttonHeight, width: "100%" },
});

export function AppleSignInButton({ accessibilityHint, loading, disabled, onPress }: BrandButtonProps) {
  const blocked = disabled || loading;
  return (
    <AppleAuthenticationButton
      buttonType={AppleAuthenticationButtonType.CONTINUE}
      buttonStyle={AppleAuthenticationButtonStyle.WHITE}
      cornerRadius={sizes.buttonHeight / 2}
      style={styles.native}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: blocked, busy: loading }}
      onPress={() => {
        if (!blocked) {
          onPress();
        }
      }}
    />
  );
}
