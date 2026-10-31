import { StyleSheet, Text, View } from "react-native";
import { colours, spacing, typeScale } from "../theme/tokens";

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.medium, marginVertical: spacing.small },
  line: { flex: 1, height: 1, backgroundColor: colours.border },
  word: { ...typeScale.label, color: colours.textSecondary },
});

export function OrDivider() {
  return (
    <View style={styles.row} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.line} />
      <Text style={styles.word}>or</Text>
      <View style={styles.line} />
    </View>
  );
}
