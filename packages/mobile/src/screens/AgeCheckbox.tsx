import { Pressable, Text, View } from "react-native";
import { authStyles } from "./authStyles";

export interface AgeCheckboxProps {
  readonly label: string;
  readonly checked: boolean;
  readonly hint?: string;
  readonly onPress: () => void;
}

/** One tick row: box and label are a single checkbox (moved out of EmailEntryScreen unchanged, to keep it under max-lines). */
export function AgeCheckbox({ label, checked, hint, onPress }: AgeCheckboxProps) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      accessibilityHint={hint}
      style={authStyles.checkboxRow}
      onPress={onPress}>
      <View style={[authStyles.checkbox, checked && authStyles.checkboxTicked]}>
        {checked ? (
          <Text style={authStyles.checkmark} accessibilityElementsHidden importantForAccessibility="no">
            ✓
          </Text>
        ) : null}
      </View>
      <Text style={authStyles.checkboxLabel}>{label}</Text>
    </Pressable>
  );
}
