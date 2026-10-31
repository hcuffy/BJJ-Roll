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
  readonly announceAgeError: boolean;
  readonly onPress16: () => void;
  readonly onPress18: () => void;
}

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
