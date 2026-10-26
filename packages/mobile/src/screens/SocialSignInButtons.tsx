import type { SocialProvider } from "../auth/socialSignIn";
import { AuthButton } from "./AuthButton";
import { missingHint } from "./missingHint";

export const SOCIAL_BUTTON_TITLES: Readonly<Record<SocialProvider, string>> = { apple: "Continue with Apple", google: "Continue with Google" };
const SOCIAL_LOADING_TITLES: Readonly<Record<SocialProvider, string>> = { apple: "Opening Apple…", google: "Opening Google…" };

export interface SocialSignInButtonsProps {
  readonly providers: readonly SocialProvider[];
  readonly ageConfirmed: boolean;
  /** What the screen is sending right now; the other buttons are disabled meanwhile. */
  readonly sending: string | null;
  readonly onPress: (provider: SocialProvider) => void;
}

/** Apple and Google sign-in (HEN-239): dimmed until the 17+ box is ticked, like the email buttons. */
export function SocialSignInButtons({ providers, ageConfirmed, sending, onPress }: SocialSignInButtonsProps) {
  return providers.map((provider) => (
    <AuthButton
      key={provider}
      title={SOCIAL_BUTTON_TITLES[provider]}
      variant="secondary"
      looksDisabled={!ageConfirmed}
      accessibilityHint={missingHint(true, ageConfirmed)}
      loading={sending === provider}
      loadingTitle={SOCIAL_LOADING_TITLES[provider]}
      disabled={sending !== null && sending !== provider}
      onPress={() => onPress(provider)}
    />
  ));
}
