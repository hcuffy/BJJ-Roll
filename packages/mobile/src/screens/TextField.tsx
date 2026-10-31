import { useEffect, useRef, useState, type ComponentRef } from "react";
import { AccessibilityInfo, Text, TextInput, View, type TextInputProps } from "react-native";
import { colours, textStyles } from "../theme/tokens";
import { StatusText } from "./StatusText";
import { authStyles } from "./authStyles";

export interface TextFieldProps extends Omit<TextInputProps, "style" | "accessibilityLabel" | "accessibilityHint"> {
  readonly label: string;
  readonly error: string | null;
  readonly focusKey?: number;
}

export const emailInputProps: TextInputProps = {
  autoCapitalize: "none",
  autoComplete: "email",
  autoCorrect: false,
  inputMode: "email",
  keyboardType: "email-address",
  textContentType: "emailAddress",
  placeholder: "you@example.com",
  returnKeyType: "go",
};

export function TextField({ label, error, focusKey, onFocus, onBlur, ...inputProps }: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const focusedKey = useRef(focusKey);
  useEffect(() => {
    if (input.current && focusKey !== focusedKey.current) {
      AccessibilityInfo.sendAccessibilityEvent(input.current, "focus");
    }
    focusedKey.current = focusKey;
  }, [focusKey]);
  return (
    <View style={authStyles.field}>
      <Text style={textStyles.label} accessibilityElementsHidden importantForAccessibility="no">
        {label}
      </Text>
      <TextInput
        {...inputProps}
        ref={input}
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
