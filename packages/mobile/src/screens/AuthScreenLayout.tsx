import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { authStyles } from "./authStyles";

/**
 * Shared frame for the sign-in screens: safe area, keyboard-avoiding, scrollable, top-aligned.
 * The safe-area-context SafeAreaView pads for the status bar, notch and home indicator on both iOS and Android
 * (Android draws edge-to-edge). Taps on buttons still work while the keyboard is open (keyboardShouldPersistTaps).
 */
export function AuthScreenLayout({ children }: { readonly children: ReactNode }) {
  return (
    <SafeAreaView style={authStyles.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={authStyles.keyboardAvoider}>
        <ScrollView contentContainerStyle={authStyles.scrollContent} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
