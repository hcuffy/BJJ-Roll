import { ActivityIndicator, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colours, textStyles } from "../theme/tokens";
import { authStyles } from "./authStyles";

/** Full-screen Loading state, used at startup and while the sign-up attestation status is read. */
export function LoadingScreen() {
  return (
    <SafeAreaView style={authStyles.safeArea}>
      <View style={authStyles.centred}>
        {/* Muted spinner (lime is for the primary action); the visible word is the one thing screen readers read. */}
        <ActivityIndicator size="large" color={colours.textSecondary} accessibilityElementsHidden importantForAccessibility="no" />
        <Text style={textStyles.bodyMuted}>Loading</Text>
      </View>
    </SafeAreaView>
  );
}
