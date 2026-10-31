export interface BrandButtonProps {
  readonly loadingTitle: string;
  readonly accessibilityHint: string | undefined;
  readonly loading: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
}
