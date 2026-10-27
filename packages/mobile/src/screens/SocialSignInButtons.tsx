import { missingHint } from "../auth/ageConfirmation";
import type { SocialProvider } from "../auth/socialSignIn";
import { AuthButton } from "./AuthButton";

export const SOCIAL_BUTTON_TITLES: Readonly<Record<SocialProvider, string>> = { apple: "Continue with Apple", google: "Continue with Google" };
const SOCIAL_LOADING_TITLES: Readonly<Record<SocialProvider, string>> = { apple: "Opening Apple…", google: "Opening Google…" };

export interface SocialSignInButtonsProps {
  readonly providers: readonly SocialProvider[];
  readonly age16Confirmed: boolean;
  /** What the screen is sending right now; the other buttons are disabled meanwhile. */
  readonly sending: string | null;
  readonly onPress: (provider: SocialProvider) => void;
}

/** Apple and Google sign-in (HEN-239): dimmed until the 16+ box is ticked, like the email buttons. */
export function SocialSignInButtons({ providers, age16Confirmed, sending, onPress }: SocialSignInButtonsProps) {
  return providers.map((provider) => (
    <AuthButton
      key={provider}
      title={SOCIAL_BUTTON_TITLES[provider]}
      variant="secondary"
      looksDisabled={!age16Confirmed}
      accessibilityHint={missingHint(true, age16Confirmed)}
      loading={sending === provider}
      loadingTitle={SOCIAL_LOADING_TITLES[provider]}
      disabled={sending !== null && sending !== provider}
      onPress={() => onPress(provider)}
    />
  ));
}
