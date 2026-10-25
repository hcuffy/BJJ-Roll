import { Text } from "react-native";
import { textStyles } from "../theme/tokens";
import { AuthButton } from "./AuthButton";
import { AuthScreenLayout } from "./AuthScreenLayout";

export interface SignedInScreenProps {
  readonly onSignOut: () => void;
}

/** Placeholder until the real home screen lands. */
export function SignedInScreen({ onSignOut }: SignedInScreenProps) {
  return (
    <AuthScreenLayout>
      <Text accessibilityRole="header" style={textStyles.display}>
        You are signed in
      </Text>
      <AuthButton title="Sign out" variant="secondary" onPress={onSignOut} />
    </AuthScreenLayout>
  );
}
