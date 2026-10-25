import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["dist/**", "node_modules/**"],
    setupFiles: ["src/__tests__/nativeModuleMocks.ts"],
    // Inline the Expo auth client so the native-module mocks above apply to its imports.
    server: { deps: { inline: ["@better-auth/expo"] } },
  },
});
