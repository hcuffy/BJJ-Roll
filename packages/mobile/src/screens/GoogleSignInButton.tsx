import { Image, Pressable, StyleSheet } from "react-native";
import googleSignInDarkPill from "../../assets/google-sign-in-dark-pill.png";
import { sizes } from "../theme/tokens";
import type { BrandButtonProps } from "./brandButtonProps";

/** The bundle's @1x image is 180×40; at 56 tall it keeps that ratio, so it is scaled, never stretched. */
const IMAGE_WIDTH = Math.round((sizes.buttonHeight * 180) / 40);

const styles = StyleSheet.create({
  button: { alignSelf: "center" },
  pressed: { opacity: 0.85 },
  image: { height: sizes.buttonHeight, width: IMAGE_WIDTH },
});

/**
 * Google's official dark pill button image from Google's sign-in branding bundle (developers.google.com/identity/branding-guidelines),
 * unedited (Henry A3, Vera interim item 1). The image is the whole button, so progress shows under the buttons, not in it.
 */
export function GoogleSignInButton({ title, accessibilityHint, loading, disabled, onPress }: BrandButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
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
