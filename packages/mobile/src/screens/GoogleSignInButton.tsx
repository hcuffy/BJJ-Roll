import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import googleG from "../../assets/google-g.png";
import { radius, sizes } from "../theme/tokens";
import type { BrandButtonProps } from "./brandButtonProps";

/**
 * Google's dark theme, from Google's "Sign in with Google" branding guidelines (developers.google.com/identity/branding-guidelines):
 * fill #131314, 1px #8E918F stroke, #E3E3E3 label, the standard colour G at its fixed 20dp, 12dp before the G and 10dp after it.
 * The guidelines name Google Sans Medium 14/20; the app bundles no Google font, so this is the system font (Roboto on Android) at weight 500.
 */
export const GOOGLE_DARK = { fill: "#131314", stroke: "#8E918F", text: "#E3E3E3" } as const;

const styles = StyleSheet.create({
  button: {
    minHeight: sizes.buttonHeight,
    borderRadius: radius.pill,
    backgroundColor: GOOGLE_DARK.fill,
    borderColor: GOOGLE_DARK.stroke,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  pressed: { transform: [{ scale: 0.98 }] },
  logo: { width: 20, height: 20 },
  label: { color: GOOGLE_DARK.text, fontSize: 14, lineHeight: 20, fontWeight: "500" },
});

export function GoogleSignInButton({ title, loadingTitle, accessibilityHint, loading, disabled, onPress }: BrandButtonProps) {
  const label = loading ? loadingTitle : title;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
      <View accessible={false} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Image source={googleG} style={styles.logo} accessible={false} accessibilityElementsHidden importantForAccessibility="no" />
      </View>
      <Text style={styles.label}>{label}</Text>
      {loading ? <ActivityIndicator color={GOOGLE_DARK.text} /> : null}
    </Pressable>
  );
}
