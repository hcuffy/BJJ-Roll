import { useEffect, useRef } from "react";
import { AccessibilityInfo, Platform, Text, type StyleProp, type TextStyle } from "react-native";

interface StatusTextProps {
  readonly message: string | null;
  readonly style: StyleProp<TextStyle>;
  readonly announce?: "alert" | "polite" | "quiet";
  readonly announceKey?: number;
}

export function StatusText({ message, style, announce = "alert", announceKey }: StatusTextProps) {
  useEffect(() => {
    if (announce !== "quiet" && message && Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility(message);
    }
  }, [message, announce]);

  const announcedKey = useRef(announceKey);
  useEffect(() => {
    if (message && announceKey && announceKey !== announcedKey.current) {
      AccessibilityInfo.announceForAccessibility(message);
    }
    announcedKey.current = announceKey;
  }, [announceKey]);

  if (!message) {
    return null;
  }
  return (
    <Text accessibilityLiveRegion="polite" accessibilityRole={announce === "alert" ? "alert" : undefined} style={style}>
      {message}
    </Text>
  );
}
