import { AppleAuthenticationButton, AppleAuthenticationButtonStyle, AppleAuthenticationButtonType } from "expo-apple-authentication";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text } from "react-native";
import { radius, sizes } from "../theme/tokens";
import type { BrandButtonProps } from "./brandButtonProps";

const styles = StyleSheet.create({
  native: { height: sizes.buttonHeight, width: "100%" },
  // Apple's HIG custom button: white fill, black title at 43% of the button height.
  custom: {
    minHeight: sizes.buttonHeight,
    borderRadius: radius.pill,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  pressed: { transform: [{ scale: 0.98 }] },
  title: { color: "#000000", fontSize: Math.round(sizes.buttonHeight * 0.43), fontWeight: "600" },
});

/**
 * iOS: Apple's own system button (ASAuthorizationAppleIDButton), which Apple draws, words and makes accessible.
 * Elsewhere (the browser flow): a white HIG pill with a black title. It carries no Apple logo, because Apple's design resources
 * licence covers apps that run only on Apple platforms; see HEN-239.md.
 */
export function AppleSignInButton({ title, loadingTitle, accessibilityHint, loading, disabled, onPress }: BrandButtonProps) {
  const blocked = disabled || loading;
  const accessibilityState = { disabled: blocked, busy: loading };
  if (Platform.OS === "ios") {
    return (
      <AppleAuthenticationButton
        buttonType={AppleAuthenticationButtonType.CONTINUE}
        buttonStyle={AppleAuthenticationButtonStyle.WHITE}
        cornerRadius={sizes.buttonHeight / 2}
        style={styles.native}
        accessibilityHint={accessibilityHint}
        accessibilityState={accessibilityState}
        onPress={() => {
          if (!blocked) {
            onPress();
          }
        }}
      />
    );
  }
  const label = loading ? loadingTitle : title;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={accessibilityState}
      disabled={blocked}
      onPress={onPress}
      style={({ pressed }) => [styles.custom, pressed && styles.pressed]}>
      <Text style={styles.title}>{label}</Text>
      {loading ? <ActivityIndicator color="#000000" /> : null}
    </Pressable>
  );
}
