import { Text, View } from "react-native";
import { AGE_ADULT_CONFIRMATION_LABEL, AGE_ADULT_CONFIRMATION_NOTE, AGE_ADULT_NEEDS_16_HINT, AGE_CONFIRMATION_LABEL } from "../auth/ageConfirmation";
import { textStyles } from "../theme/tokens";
import { AgeCheckbox } from "./AgeCheckbox";
import { StatusText } from "./StatusText";
import { authStyles } from "./authStyles";

export interface AgeConfirmationFieldsProps {
  readonly age16Confirmed: boolean;
  readonly age18Confirmed: boolean;
  readonly ageError: string | null;
  /** False when a new email error from the same submit is the one announced (Vera items 8 and delta 6). */
  readonly announceAgeError: boolean;
  readonly onPress16: () => void;
  readonly onPress18: () => void;
}

/** The required 16+ box with its error, and the optional 18+ box, which stays disabled until 16+ is ticked (HEN-263). */
export function AgeConfirmationFields({
  age16Confirmed,
  age18Confirmed,
  ageError,
  announceAgeError,
  onPress16,
  onPress18,
}: AgeConfirmationFieldsProps) {
  return (
    <View style={authStyles.ageGroup}>
      <View>
        <AgeCheckbox label={AGE_CONFIRMATION_LABEL} checked={age16Confirmed} hint={ageError ?? undefined} onPress={onPress16} />
        {/* After an empty submit the new email error is read first; this one stays visible but is not announced over it. */}
        <StatusText message={ageError} style={authStyles.fieldError} announce={announceAgeError ? "alert" : "quiet"} />
      </View>
      <View style={authStyles.ageOptional}>
        <AgeCheckbox
          label={AGE_ADULT_CONFIRMATION_LABEL}
          checked={age18Confirmed}
          disabled={!age16Confirmed}
          hint={age16Confirmed ? undefined : AGE_ADULT_NEEDS_16_HINT}
          onPress={onPress18}
        />
        <Text style={textStyles.bodyMuted}>{AGE_ADULT_CONFIRMATION_NOTE}</Text>
      </View>
    </View>
  );
}
