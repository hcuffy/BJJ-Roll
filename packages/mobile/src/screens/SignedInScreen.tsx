import { Text, View } from "react-native";
import { textStyles } from "../theme/tokens";
import { AuthButton } from "./AuthButton";
import { authStyles } from "./authStyles";

export interface SignedInScreenProps {
  readonly onSignOut: () => void;
}

/** Placeholder until the real home screen lands. */
export function SignedInScreen({ onSignOut }: SignedInScreenProps) {
  return (
    <View style={authStyles.screen}>
      <Text style={textStyles.title}>You are signed in</Text>
      <AuthButton title="Sign out" onPress={onSignOut} />
    </View>
  );
}
