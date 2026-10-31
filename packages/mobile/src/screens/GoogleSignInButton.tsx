import { Image, Pressable, StyleSheet } from "react-native";
import googleSignInDarkPill from "../../assets/google-sign-in-dark-pill.png";
import { sizes } from "../theme/tokens";
import type { BrandButtonProps } from "./brandButtonProps";

const GOOGLE_BUTTON_TITLE = "Sign in with Google";

const IMAGE_WIDTH = Math.round((sizes.buttonHeight * 180) / 40);

const styles = StyleSheet.create({
  button: { alignSelf: "center" },
  pressed: { opacity: 0.85 },
  image: { height: sizes.buttonHeight, width: IMAGE_WIDTH },
});

export function GoogleSignInButton({ accessibilityHint, loading, disabled, onPress }: BrandButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={GOOGLE_BUTTON_TITLE}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
      <Image
        source={googleSignInDarkPill}
        style={styles.image}
        resizeMode="contain"
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
    </Pressable>
  );
}
