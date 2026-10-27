import { StyleSheet, Text, View } from "react-native";
import { colours, spacing, typeScale } from "../theme/tokens";

const styles = StyleSheet.create({
  // Sits in a 16-gap stack: 8 more each side gives the 24 section gap (Vera Round 4 item 4).
  row: { flexDirection: "row", alignItems: "center", gap: spacing.medium, marginVertical: spacing.small },
  line: { flex: 1, height: 1, backgroundColor: colours.border },
  word: { ...typeScale.label, color: colours.textSecondary },
});

/** "or" between the email sign-in and the brand buttons. Decorative, so screen readers skip the whole row. */
export function OrDivider() {
  return (
    <View style={styles.row} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.line} />
      <Text style={styles.word}>or</Text>
      <View style={styles.line} />
    </View>
  );
}
