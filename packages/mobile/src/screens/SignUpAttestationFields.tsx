import { StyleSheet, Text, View } from "react-native";
import { ATTESTATION_LEAD, ATTESTATION_VERSION_NOTE, SIGN_UP_ATTESTATION_DUTIES, SIGN_UP_ATTESTATION_LABEL } from "../auth/signUpAttestation";
import { colours, radius, spacing, textStyles, typeScale } from "../theme/tokens";
import { AgeCheckbox } from "./AgeCheckbox";
import { StatusText } from "./StatusText";
import { authStyles } from "./authStyles";

const styles = StyleSheet.create({
  // One surface card (Vera #74 item 4). The screen layout gap is 16, so the 8 margin makes 24 above the card.
  card: {
    backgroundColor: colours.surface,
    borderRadius: radius.card,
    padding: spacing.medium,
    gap: spacing.small,
    marginTop: spacing.small,
  },
  lead: { ...typeScale.body, fontWeight: "600", color: colours.textPrimary },
  duty: { flexDirection: "row", gap: spacing.small },
  dutyText: { ...textStyles.body, flexShrink: 1 },
});

export interface SignUpAttestationFieldsProps {
  readonly accepted: boolean;
  readonly error: string | null;
  /** False when another error from the same submit is the one announced. */
  readonly announceError?: boolean;
  readonly onPress: () => void;
}

/** The three sign-up duties, the text version they belong to, and the required accept box, in one card (HEN-183). */
export function SignUpAttestationFields({ accepted, error, announceError = true, onPress }: SignUpAttestationFieldsProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.lead}>{ATTESTATION_LEAD}</Text>
      {SIGN_UP_ATTESTATION_DUTIES.map((duty) => (
        <View key={duty} style={styles.duty}>
          {/* The bullet is decoration: screen readers read the duty alone (Vera #74 item 5). */}
          <Text style={textStyles.body} accessibilityElementsHidden importantForAccessibility="no">
            •
          </Text>
          <Text style={styles.dutyText}>{duty}</Text>
        </View>
      ))}
      <Text style={textStyles.caption}>{ATTESTATION_VERSION_NOTE}</Text>
      <View>
        <AgeCheckbox label={SIGN_UP_ATTESTATION_LABEL} checked={accepted} hint={error ?? undefined} onPress={onPress} />
        <StatusText message={error} style={authStyles.fieldError} announce={announceError ? "alert" : "quiet"} />
      </View>
    </View>
  );
}
