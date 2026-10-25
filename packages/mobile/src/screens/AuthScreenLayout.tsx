import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, SafeAreaView, ScrollView, StatusBar } from "react-native";
import { authStyles } from "./authStyles";

/**
 * Shared frame for the sign-in screens: safe area, keyboard-avoiding, scrollable, top-aligned.
 * Taps on buttons still work while the keyboard is open (keyboardShouldPersistTaps).
 */
export function AuthScreenLayout({ children }: { readonly children: ReactNode }) {
  // Android draws edge-to-edge, so the content starts below the status bar; iOS uses the safe area.
  const statusBarInset = Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;
  return (
    <SafeAreaView style={authStyles.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={authStyles.keyboardAvoider}>
        <ScrollView
          contentContainerStyle={[
            authStyles.scrollContent,
            statusBarInset > 0 && { paddingTop: authStyles.scrollContent.paddingTop + statusBarInset },
          ]}
          keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
