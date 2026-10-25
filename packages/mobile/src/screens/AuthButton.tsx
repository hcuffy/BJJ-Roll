import { Pressable, Text } from "react-native";
import { authStyles } from "./authStyles";

export interface AuthButtonProps {
  readonly title: string;
  readonly disabled?: boolean;
  readonly variant?: "primary" | "link";
  readonly onPress: () => void;
}

export function AuthButton({ title, disabled = false, variant = "primary", onPress }: AuthButtonProps) {
  const isLink = variant === "link";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[isLink ? authStyles.linkButton : authStyles.button, disabled && authStyles.buttonDisabled]}>
      <Text style={isLink ? authStyles.linkButtonText : authStyles.buttonText}>{title}</Text>
    </Pressable>
  );
}
