import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { missingHint } from "../auth/ageConfirmation";
import type { SocialProvider } from "../auth/socialSignIn";
import { colours, typeScale } from "../theme/tokens";
import { AppleSignInButton } from "./AppleSignInButton";
import { GoogleSignInButton } from "./GoogleSignInButton";
import { OrDivider } from "./OrDivider";
import { StatusText } from "./StatusText";
import { authStyles } from "./authStyles";

const SOCIAL_LOADING_TITLES: Readonly<Record<SocialProvider, string>> = { apple: "Opening Apple…", google: "Opening Google…" };
/** After the browser or Apple's sheet returns, while the backend makes the session (Vera interim item 5). */
export const SOCIAL_SIGNING_IN_TITLE = "Signing in…";
const BRAND_BUTTONS = { apple: AppleSignInButton, google: GoogleSignInButton } as const;

const styles = StyleSheet.create({
  notYet: { ...typeScale.label, color: colours.textSecondary, textAlign: "center" },
  progressRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  progress: { ...typeScale.label, color: colours.textSecondary },
});

export interface SocialSignInButtonsProps {
  readonly providers: readonly SocialProvider[];
  readonly age16Confirmed: boolean;
  /** The sign-up duties box is ticked (HEN-183); until then the muted line says so. */
  readonly attestationAccepted?: boolean;
  /** What the screen is sending right now; the other buttons are disabled meanwhile. */
  readonly sending: string | null;
  readonly onPress: (provider: SocialProvider) => void;
  /** While a provider runs: "opening" until the browser or sheet returns, then "signingIn". */
  readonly progress?: "opening" | "signingIn";
  /** The last social attempt's error, shown under the buttons (Vera interim item 6). */
  readonly error?: string | null;
}

/**
 * Apple and Google sign-in (HEN-239) in each brand's own style, after an "or" row so the email sign-in above stays first.
 * Order: "or", the 16+ line, the buttons, progress, then a social error. Brand buttons are never dimmed: until the 16+ box
 * is ticked a muted line says why (screen readers get the same words as the buttons' hint) and a tap explains instead of signing in.
 */
export function SocialSignInButtons({
  providers,
  age16Confirmed,
  attestationAccepted = true,
  sending,
  onPress,
  progress = "opening",
  error = null,
}: SocialSignInButtonsProps) {
  const hint = missingHint(true, age16Confirmed, attestationAccepted);
  const running = providers.find((provider) => provider === sending);
  return (
    <>
      {providers.length > 0 ? <OrDivider /> : null}
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
            loadingTitle={SOCIAL_LOADING_TITLES[provider]}
            accessibilityHint={hint}
            loading={sending === provider}
            disabled={sending !== null && sending !== provider}
            onPress={() => onPress(provider)}
          />
        );
      })}
      {running ? (
        <View style={styles.progressRow}>
          <ActivityIndicator
            size="small"
            color={colours.textSecondary}
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
          <StatusText
            message={progress === "opening" ? SOCIAL_LOADING_TITLES[running] : SOCIAL_SIGNING_IN_TITLE}
            style={styles.progress}
            announce="polite"
          />
        </View>
      ) : null}
      <StatusText message={error} style={authStyles.fieldError} />
    </>
  );
}
