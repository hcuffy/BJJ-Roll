import { useEffect, useState, type ReactNode } from "react";
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { spacing } from "../theme/tokens";
import { authStyles } from "./authStyles";

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
