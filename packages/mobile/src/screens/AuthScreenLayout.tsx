import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { spacing } from "../theme/tokens";
import { authStyles } from "./authStyles";

/**
 * Shared frame for the sign-in screens: safe area, keyboard-avoiding, scrollable, top-aligned.
 * - Top and sides: safe-area-context SafeAreaView (status bar, notch, cut-outs; Android draws edge-to-edge).
 * - Bottom: the nav bar / home indicator inset plus 24 is padding inside the scroll view, so the last button
 *   can always scroll clear of it.
 * - Keyboard: iOS pads, Android shrinks the view by the keyboard height (edge-to-edge apps cannot rely on
 *   adjustResize alone). Taps work with the keyboard open, and dragging the content closes it
 *   (the iOS number pad has no Done key).
 */
export function AuthScreenLayout({ children }: { readonly children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <SafeAreaView edges={["top", "left", "right"]} style={authStyles.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={authStyles.keyboardAvoider}>
        <ScrollView
          contentContainerStyle={[authStyles.scrollContent, { paddingBottom: insets.bottom + spacing.large }]}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
