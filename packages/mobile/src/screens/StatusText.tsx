import { useEffect } from "react";
import { AccessibilityInfo, Platform, Text, type StyleProp, type TextStyle } from "react-native";

interface StatusTextProps {
  readonly message: string | null;
  readonly style: StyleProp<TextStyle>;
  /**
   * False for a message that appears together with an earlier one (HEN-263, Vera item 8): it stays a polite live region,
   * but drops role alert and the iOS announcement, so it does not cut off the first.
   */
  readonly announce?: boolean;
}

/**
 * An error or notice that screen readers hear as soon as it appears:
 * a polite live region on Android, an explicit announcement on iOS (which ignores live regions).
 */
export function StatusText({ message, style, announce = true }: StatusTextProps) {
  useEffect(() => {
    if (announce && message && Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility(message);
    }
  }, [message, announce]);

  if (!message) {
    return null;
  }
  return (
    <Text accessibilityLiveRegion="polite" accessibilityRole={announce ? "alert" : undefined} style={style}>
      {message}
    </Text>
  );
}
