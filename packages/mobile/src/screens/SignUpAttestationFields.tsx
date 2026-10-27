import { Text, View } from "react-native";
import { ATTESTATION_VERSION_NOTE, SIGN_UP_ATTESTATION_DUTIES, SIGN_UP_ATTESTATION_LABEL } from "../auth/signUpAttestation";
import { textStyles } from "../theme/tokens";
import { AgeCheckbox } from "./AgeCheckbox";
import { StatusText } from "./StatusText";
import { authStyles } from "./authStyles";

export interface SignUpAttestationFieldsProps {
  readonly accepted: boolean;
  readonly error: string | null;
  /** False when another error from the same submit is the one announced. */
  readonly announceError?: boolean;
  readonly onPress: () => void;
}

/** The three sign-up duties, the text version they belong to, and the required accept box (HEN-183). */
export function SignUpAttestationFields({ accepted, error, announceError = true, onPress }: SignUpAttestationFieldsProps) {
  return (
    <View style={authStyles.ageGroup}>
      <View style={authStyles.heading}>
        {SIGN_UP_ATTESTATION_DUTIES.map((duty) => (
          <Text key={duty} style={textStyles.body}>{`• ${duty}`}</Text>
        ))}
        <Text style={textStyles.bodyMuted}>{ATTESTATION_VERSION_NOTE}</Text>
      </View>
      <View>
        <AgeCheckbox label={SIGN_UP_ATTESTATION_LABEL} checked={accepted} hint={error ?? undefined} onPress={onPress} />
        <StatusText message={error} style={authStyles.fieldError} announce={announceError ? "alert" : "quiet"} />
      </View>
    </View>
  );
}
