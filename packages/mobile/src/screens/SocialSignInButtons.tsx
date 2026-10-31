import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { missingHint } from "../auth/ageConfirmation";
import type { SocialProvider } from "../auth/socialSignIn";
import { colours, typeScale } from "../theme/tokens";
import { AppleSignInButton } from "./AppleSignInButton";
import { GoogleSignInButton } from "./GoogleSignInButton";
import { OrDivider } from "./OrDivider";
import { StatusText } from "./StatusText";
import { authStyles } from "./authStyles";

const socialLoadingTitles: Readonly<Record<SocialProvider, string>> = { apple: "Opening Apple…", google: "Opening Google…" };
const SOCIAL_SIGNING_IN_TITLE = "Signing in…";
const brandButtons = { apple: AppleSignInButton, google: GoogleSignInButton } as const;

const styles = StyleSheet.create({
  notYet: { ...typeScale.label, color: colours.textSecondary, textAlign: "center" },
  progressRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  progress: { ...typeScale.label, color: colours.textSecondary },
});

export interface SocialSignInButtonsProps {
  readonly providers: readonly SocialProvider[];
  readonly age16Confirmed: boolean;
  readonly attestationAccepted?: boolean;
  readonly sending: string | null;
  readonly onPress: (provider: SocialProvider) => void;
  readonly progress?: "opening" | "signingIn";
  readonly error?: string | null;
}

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
        const BrandButton = brandButtons[provider];
        return (
          <BrandButton
            key={provider}
            loadingTitle={socialLoadingTitles[provider]}
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
            message={progress === "opening" ? socialLoadingTitles[running] : SOCIAL_SIGNING_IN_TITLE}
            style={styles.progress}
            announce="polite"
          />
        </View>
      ) : null}
      <StatusText message={error} style={authStyles.fieldError} />
    </>
  );
}
