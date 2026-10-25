import { StyleSheet } from "react-native";
import { colours, spacing, typeScale } from "../theme/tokens";

export const authStyles = StyleSheet.create({
  screen: { flex: 1, justifyContent: "center", padding: spacing.large, gap: spacing.medium, backgroundColor: colours.background },
  input: { ...typeScale.body, borderWidth: 1, borderColor: colours.border, borderRadius: 8, padding: spacing.small, color: colours.textPrimary },
  checkboxRow: { flexDirection: "row", alignItems: "center", gap: spacing.small },
  checkbox: { width: 24, height: 24, borderWidth: 2, borderColor: colours.border, borderRadius: 4, alignItems: "center", justifyContent: "center" },
  checkboxTicked: { backgroundColor: colours.primary, borderColor: colours.primary },
  checkmark: { color: colours.onPrimary, fontWeight: "700" },
  button: { backgroundColor: colours.primary, borderRadius: 8, padding: spacing.medium, alignItems: "center" },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { ...typeScale.body, color: colours.onPrimary, fontWeight: "600" },
  linkButton: { padding: spacing.small, alignItems: "center" },
  linkButtonText: { ...typeScale.body, color: colours.primary },
  error: { ...typeScale.body, color: colours.danger },
});
