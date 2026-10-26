import { useEffect } from "react";
import { AccessibilityInfo, Platform, Text, type StyleProp, type TextStyle } from "react-native";

/**
 * An error or notice that screen readers hear as soon as it appears:
 * a polite live region on Android, an explicit announcement on iOS (which ignores live regions).
 * `announce="polite"` drops the alert role for calm notes; errors keep the default "alert".
 */
export function StatusText({
  message,
  style,
  announce = "alert",
}: {
  readonly message: string | null;
  readonly style: StyleProp<TextStyle>;
  readonly announce?: "polite" | "alert";
}) {
  useEffect(() => {
    if (message && Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility(message);
    }
  }, [message]);

  if (!message) {
    return null;
  }
  return (
    <Text accessibilityLiveRegion="polite" accessibilityRole={announce === "alert" ? "alert" : undefined} style={style}>
      {message}
    </Text>
  );
}
