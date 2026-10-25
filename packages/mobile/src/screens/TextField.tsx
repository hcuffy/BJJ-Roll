import { useState } from "react";
import { Text, TextInput, View, type TextInputProps } from "react-native";
import { colours, textStyles } from "../theme/tokens";
import { StatusText } from "./StatusText";
import { authStyles } from "./authStyles";

export interface TextFieldProps extends Omit<TextInputProps, "style" | "accessibilityLabel" | "accessibilityHint"> {
  /** Shown above the field and used as its accessibility label. */
  readonly label: string;
  /** Shown under the field in danger colour, announced, and read as the field's hint. */
  readonly error: string | null;
}

export function TextField({ label, error, onFocus, onBlur, ...inputProps }: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={authStyles.field}>
      {/* The input carries the same label, so screen readers skip this visual copy. */}
      <Text style={textStyles.label} accessibilityElementsHidden importantForAccessibility="no">
        {label}
      </Text>
      <TextInput
        {...inputProps}
        accessibilityLabel={label}
        accessibilityHint={error ?? undefined}
        placeholderTextColor={colours.textSecondary}
        selectionColor={colours.primary}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={[authStyles.input, focused && authStyles.inputFocused, error !== null && authStyles.inputError]}
      />
      <StatusText message={error} style={authStyles.fieldError} />
    </View>
  );
}
