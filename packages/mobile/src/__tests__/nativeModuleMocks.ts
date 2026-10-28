import { vi } from "vitest";

// Stand-ins for the native modules the app loads, so it runs under Vitest in Node.
// Host components are plain strings that screenHarness.ts renders and queries.
vi.mock("react-native", async () => ({
  // addListener is backed by keyboardHarness so a test can open and close the keyboard.
  Keyboard: { addListener: (await import("./keyboardHarness")).harnessKeyboardAddListener },
  // Mutable so a test can switch to "ios" and back.
  Platform: { OS: "android" },
  AccessibilityInfo: { announceForAccessibility: vi.fn(), sendAccessibilityEvent: vi.fn() },
  AppState: { addEventListener: () => ({ remove: () => undefined }) },
  Share: { share: vi.fn(() => Promise.resolve({ action: "sharedAction" })) },
  StyleSheet: { create: <Styles>(styles: Styles) => styles },
  ActivityIndicator: "ActivityIndicator",
  Image: "Image",
  Pressable: "Pressable",
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
  KeyboardAvoidingView: "KeyboardAvoidingView",
  ScrollView: "ScrollView",
  StatusBar: "StatusBar",
  Switch: "Switch",
}));
// The safe-area library's view gets its own host name so tests can tell it apart from RN's deprecated built-in.
vi.mock("react-native-safe-area-context", async () => {
  const { safeAreaInsetsState } = await import("./screenHarness");
  return { SafeAreaProvider: "SafeAreaProvider", SafeAreaView: "SafeAreaContextView", useSafeAreaInsets: () => safeAreaInsetsState };
});
vi.mock("react", async (importOriginal) => {
  const { harnessUseEffect, harnessUseReference, harnessUseState } = await import("./screenHarness");
  return { ...(await importOriginal<typeof import("react")>()), useState: harnessUseState, useEffect: harnessUseEffect, useRef: harnessUseReference };
});
vi.mock("expo-constants", () => ({ default: { expoConfig: { scheme: "bjjroll" } } }));
vi.mock("expo-linking", async () => {
  const { deepLinkState } = await import("./screenHarness");
  return { createURL: (path: string) => `bjjroll://${path}`, useURL: () => deepLinkState.url };
});
vi.mock("expo-web-browser", () => ({ openAuthSessionAsync: vi.fn(() => Promise.resolve({ type: "cancel" })), dismissAuthSession: vi.fn() }));
vi.mock("expo-apple-authentication", () => ({
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
  AppleAuthenticationButton: "AppleAuthenticationButton",
  AppleAuthenticationButtonType: { SIGN_IN: 0, CONTINUE: 1, SIGN_UP: 2 },
  AppleAuthenticationButtonStyle: { WHITE: 0, WHITE_OUTLINE: 1, BLACK: 2 },
  signInAsync: vi.fn(() => Promise.reject(Object.assign(new Error("canceled"), { code: "ERR_REQUEST_CANCELED" }))),
}));
// expo-crypto backed by Node's crypto, so nonces are really random and hashes really SHA-256.
vi.mock("expo-crypto", async () => {
  const { createHash, randomBytes } = await import("node:crypto");
  return {
    CryptoDigestAlgorithm: { SHA256: "SHA-256" },
    getRandomBytes: (byteCount: number) => new Uint8Array(randomBytes(byteCount)),
    digestStringAsync: (algorithm: string, data: string) =>
      Promise.resolve(algorithm === "SHA-256" ? createHash("sha256").update(data).digest("hex") : Promise.reject(new Error("unsupported"))),
  };
});
// The OS biometric prompt; tests set the phone up through localAuthenticationFake.
vi.mock("expo-local-authentication", async () => (await import("./localAuthenticationFake")).localAuthenticationModule);
