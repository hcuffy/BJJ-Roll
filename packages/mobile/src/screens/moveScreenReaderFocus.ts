import type { ComponentRef } from "react";
import { AccessibilityInfo, type Text, type View } from "react-native";

export function moveScreenReaderFocus(target: ComponentRef<typeof Text> | ComponentRef<typeof View> | null): void {
  if (target) {
    AccessibilityInfo.sendAccessibilityEvent(target, "focus");
  }
}
