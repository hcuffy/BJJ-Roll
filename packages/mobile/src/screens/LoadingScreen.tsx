import { ActivityIndicator, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colours, textStyles } from "../theme/tokens";
import { authStyles } from "./authStyles";

export function LoadingScreen() {
  return (
    <SafeAreaView style={authStyles.safeArea}>
      <View style={authStyles.centred}>
        <ActivityIndicator size="large" color={colours.textSecondary} accessibilityElementsHidden importantForAccessibility="no" />
        <Text style={textStyles.bodyMuted}>Loading</Text>
      </View>
    </SafeAreaView>
  );
}
