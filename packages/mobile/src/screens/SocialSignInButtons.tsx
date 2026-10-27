import { StyleSheet, Text } from "react-native";
import { missingHint } from "../auth/ageConfirmation";
import type { SocialProvider } from "../auth/socialSignIn";
import { colours, typeScale } from "../theme/tokens";
import { AppleSignInButton } from "./AppleSignInButton";
import { GoogleSignInButton } from "./GoogleSignInButton";

export const SOCIAL_BUTTON_TITLES: Readonly<Record<SocialProvider, string>> = { apple: "Continue with Apple", google: "Continue with Google" };
const SOCIAL_LOADING_TITLES: Readonly<Record<SocialProvider, string>> = { apple: "Opening Apple…", google: "Opening Google…" };
const BRAND_BUTTONS = { apple: AppleSignInButton, google: GoogleSignInButton } as const;

const styles = StyleSheet.create({
  notYet: { ...typeScale.label, color: colours.textSecondary, textAlign: "center" },
});

export interface SocialSignInButtonsProps {
  readonly providers: readonly SocialProvider[];
  readonly age16Confirmed: boolean;
  /** What the screen is sending right now; the other buttons are disabled meanwhile. */
  readonly sending: string | null;
  readonly onPress: (provider: SocialProvider) => void;
}

/**
 * Apple and Google sign-in (HEN-239) in each brand's own style. Brand buttons are never dimmed: until the 16+ box is ticked
 * a muted line says why (screen readers get the same words as the buttons' hint) and a tap explains instead of signing in.
 */
export function SocialSignInButtons({ providers, age16Confirmed, sending, onPress }: SocialSignInButtonsProps) {
  const hint = missingHint(true, age16Confirmed);
  return (
    <>
      {hint && providers.length > 0 ? (
        <Text style={styles.notYet} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {hint}
        </Text>
      ) : null}
      {providers.map((provider) => {
        const BrandButton = BRAND_BUTTONS[provider];
        return (
          <BrandButton
            key={provider}
            title={SOCIAL_BUTTON_TITLES[provider]}
            loadingTitle={SOCIAL_LOADING_TITLES[provider]}
            accessibilityHint={hint}
            loading={sending === provider}
            disabled={sending !== null && sending !== provider}
            onPress={() => onPress(provider)}
          />
        );
      })}
    </>
  );
}
