import { StyleSheet, Text, View } from "react-native";
import { ATTESTATION_LEAD, ATTESTATION_VERSION_NOTE, signUpAttestationDuties, SIGN_UP_ATTESTATION_LABEL } from "../auth/signUpAttestation";
import { colours, radius, spacing, textStyles, typeScale } from "../theme/tokens";
import { AgeCheckbox } from "./AgeCheckbox";
import { StatusText } from "./StatusText";
import { authStyles } from "./authStyles";

const styles = StyleSheet.create({
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
  readonly announceError?: boolean;
  readonly onPress: () => void;
}

export function SignUpAttestationFields({ accepted, error, announceError = true, onPress }: SignUpAttestationFieldsProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.lead}>{ATTESTATION_LEAD}</Text>
      {signUpAttestationDuties.map((duty) => (
        <View key={duty} style={styles.duty}>
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
