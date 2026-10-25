import { useEffect, useState, type ReactNode } from "react";
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { spacing } from "../theme/tokens";
import { authStyles } from "./authStyles";

/**
 * Shared frame for the sign-in screens: safe area, keyboard-avoiding, scrollable, top-aligned.
 * - Top and sides: safe-area-context SafeAreaView (status bar, notch, cut-outs; Android draws edge-to-edge).
 * - Bottom: the nav bar / home indicator inset plus 24 is padding inside the scroll view, so the last button
 *   can always scroll clear of it. On iOS the keyboard covers the home indicator, so while it is open the gap is 24 only.
 * - Keyboard: iOS pads, Android shrinks the view by the keyboard height (edge-to-edge apps cannot rely on
 *   adjustResize alone). Taps work with the keyboard open, and dragging the content closes it
 *   (the iOS number pad has no Done key).
 */
export function AuthScreenLayout({ children }: { readonly children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const iosKeyboardOpen = useIosKeyboardOpen();
  return (
    <SafeAreaView edges={["top", "left", "right"]} style={authStyles.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={authStyles.keyboardAvoider}>
        <ScrollView
          contentContainerStyle={[authStyles.scrollContent, { paddingBottom: (iosKeyboardOpen ? 0 : insets.bottom) + spacing.large }]}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** True while the iOS keyboard is open (or opening). Always false on Android. */
function useIosKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (Platform.OS !== "ios") {
      return undefined;
    }
    const show = Keyboard.addListener("keyboardWillShow", () => setOpen(true));
    const hide = Keyboard.addListener("keyboardWillHide", () => setOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return open;
}
