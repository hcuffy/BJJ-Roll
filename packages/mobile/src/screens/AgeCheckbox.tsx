import { Pressable, Text, View } from "react-native";
import { authStyles } from "./authStyles";

export interface AgeCheckboxProps {
  readonly label: string;
  readonly checked: boolean;
  readonly hint?: string;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}

export function AgeCheckbox({ label, checked, hint, disabled = false, onPress }: AgeCheckboxProps) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled }}
      accessibilityHint={hint}
      disabled={disabled}
      style={authStyles.checkboxRow}
      onPress={onPress}>
      <View style={[authStyles.checkbox, checked && authStyles.checkboxTicked, disabled && authStyles.checkboxDisabled]}>
        {checked ? (
          <Text style={authStyles.checkmark} accessibilityElementsHidden importantForAccessibility="no">
            ✓
          </Text>
        ) : null}
      </View>
      <Text style={[authStyles.checkboxLabel, disabled && authStyles.checkboxLabelDisabled]}>{label}</Text>
    </Pressable>
  );
}
