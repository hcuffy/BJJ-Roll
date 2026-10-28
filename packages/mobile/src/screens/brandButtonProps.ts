/** What every brand sign-in button (Google, Apple) takes from SocialSignInButtons. */
export interface BrandButtonProps {
  readonly loadingTitle: string;
  /** Read after the label by screen readers, e.g. why a tap will not sign in yet. */
  readonly accessibilityHint: string | undefined;
  /** This sign-in is running: shows `loadingTitle` and blocks presses. */
  readonly loading: boolean;
  /** Another sign-in is running: blocks presses, announced as disabled, brand colours kept. */
  readonly disabled: boolean;
  readonly onPress: () => void;
}
