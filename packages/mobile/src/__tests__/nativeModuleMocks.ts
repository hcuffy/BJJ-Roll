import { vi } from "vitest";

// Stand-ins for the native modules the Expo auth client loads, so it runs under Vitest in Node.
vi.mock("react-native", () => ({
  Platform: { OS: "android" },
  AppState: { addEventListener: () => ({ remove: () => undefined }) },
}));
vi.mock("expo-constants", () => ({ default: { expoConfig: { scheme: "bjjroll" } } }));
vi.mock("expo-linking", () => ({ createURL: (path: string) => `bjjroll://${path}` }));
