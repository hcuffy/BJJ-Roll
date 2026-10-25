import { useEffect } from "react";
import { AccessibilityInfo, Platform, Text, type StyleProp, type TextStyle } from "react-native";

/**
 * An error or notice that screen readers hear as soon as it appears:
 * a polite live region on Android, an explicit announcement on iOS (which ignores live regions).
 */
export function StatusText({ message, style }: { readonly message: string | null; readonly style: StyleProp<TextStyle> }) {
  useEffect(() => {
    if (message && Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility(message);
    }
  }, [message]);

  if (!message) {
    return null;
  }
  return (
    <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={style}>
      {message}
    </Text>
  );
}
