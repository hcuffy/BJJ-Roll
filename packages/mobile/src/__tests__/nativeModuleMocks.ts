import { vi } from "vitest";

// Stand-ins for the native modules the app loads, so it runs under Vitest in Node.
// Host components are plain strings that screenHarness.ts renders and queries.
vi.mock("react-native", () => ({
  // Mutable so a test can switch to "ios" and back.
  Platform: { OS: "android" },
  AccessibilityInfo: { announceForAccessibility: vi.fn() },
  AppState: { addEventListener: () => ({ remove: () => undefined }) },
  StyleSheet: { create: <Styles>(styles: Styles) => styles },
  ActivityIndicator: "ActivityIndicator",
  Pressable: "Pressable",
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
  KeyboardAvoidingView: "KeyboardAvoidingView",
  ScrollView: "ScrollView",
  StatusBar: "StatusBar",
}));
// The safe-area library's view gets its own host name so tests can tell it apart from RN's deprecated built-in.
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaProvider: "SafeAreaProvider",
  SafeAreaView: "SafeAreaContextView",
}));
vi.mock("react", async (importOriginal) => {
  const { harnessUseEffect, harnessUseState } = await import("./screenHarness");
  return { ...(await importOriginal<typeof import("react")>()), useState: harnessUseState, useEffect: harnessUseEffect };
});
vi.mock("expo-constants", () => ({ default: { expoConfig: { scheme: "bjjroll" } } }));
vi.mock("expo-linking", async () => {
  const { deepLinkState } = await import("./screenHarness");
  return { createURL: (path: string) => `bjjroll://${path}`, useURL: () => deepLinkState.url };
});
