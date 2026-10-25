import { StyleSheet } from "react-native";
import { colours, radius, sizes, spacing, typeScale } from "../theme/tokens";

export const authStyles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colours.background },
  keyboardAvoider: { flex: 1 },
  // Top-aligned content: 16 screen padding, 24 above the first element, 16 between blocks.
  scrollContent: {
    flexGrow: 1,
    backgroundColor: colours.background,
    paddingHorizontal: spacing.medium,
    paddingTop: spacing.large,
    paddingBottom: spacing.large,
    gap: spacing.medium,
  },
  centred: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.medium, backgroundColor: colours.background },
  heading: { gap: spacing.small },
  field: { gap: spacing.small },
  input: {
    ...typeScale.body,
    minHeight: sizes.minTapTarget,
    paddingHorizontal: spacing.medium,
    paddingVertical: 12,
    borderRadius: radius.input,
    backgroundColor: colours.surfaceRaised,
    borderWidth: 1,
    borderColor: colours.border,
    color: colours.textPrimary,
  },
  // The 2pt rings take 1pt more than the resting border, so padding shrinks by 1 and the text does not jump.
  inputFocused: { borderWidth: 2, borderColor: colours.primary, paddingHorizontal: spacing.medium - 1, paddingVertical: 11 },
  inputError: { borderWidth: 2, borderColor: colours.danger, paddingHorizontal: spacing.medium - 1, paddingVertical: 11 },
  checkboxRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: sizes.minTapTarget },
  checkbox: {
    width: sizes.checkbox,
    height: sizes.checkbox,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colours.textSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxTicked: { backgroundColor: colours.primary, borderColor: colours.primary },
  checkmark: { ...typeScale.body, color: colours.onPrimary, fontWeight: "700" },
  checkboxLabel: { ...typeScale.body, color: colours.textPrimary, flexShrink: 1 },
  fieldError: { ...typeScale.label, color: colours.danger },
  notice: { ...typeScale.body, color: colours.textPrimary },
  card: { backgroundColor: colours.surface, borderRadius: radius.card, padding: spacing.medium, flexDirection: "row", gap: 12 },
  errorCard: { borderWidth: 1, borderColor: colours.danger },
  cardIcon: { ...typeScale.title, color: colours.textPrimary },
  cardBody: { flex: 1, gap: spacing.small },
  cardError: { ...typeScale.body, color: colours.danger },
  // gap 16 + 8 = 24 between the last field and the buttons.
  actions: { gap: spacing.medium, marginTop: spacing.small },
});
