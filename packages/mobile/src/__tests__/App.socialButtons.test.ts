import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMobileAuthClient } from "../auth/authClient";
import type { SocialProvider, SocialSignInDependencies } from "../auth/socialSignIn";
import { EmailEntryScreen } from "../screens/EmailEntryScreen";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL } from "./authTestDoubles";
import { renderScreen } from "./screenHarness";
import appConfig from "../../app.json";

vi.mock("../auth/appAuthClient", () => ({ appAuthClient: null, appSecureStore: null, appBackendUrl: "http://backend.test" }));

/** The sign-in wiring the shipped app (app.json) gets on a platform, read the way App.tsx reads it. */
async function shippedSocialSignIn(platform: string): Promise<{ providers: readonly SocialProvider[]; socialSignIn: SocialSignInDependencies }> {
  vi.resetModules();
  vi.doMock("expo-constants", () => ({ default: { expoConfig: appConfig.expo } }));
  const { Platform } = await import("react-native");
  Platform.OS = platform as typeof Platform.OS;
  const { appSocialProviders, appSocialSignIn } = await import("../auth/appSocialSignIn");
  return { providers: appSocialProviders, socialSignIn: appSocialSignIn };
}

describe("HEN-239 sign-in buttons in the shipped config (Apple off)", () => {
  afterEach(async () => {
    vi.doUnmock("expo-constants");
    (await import("react-native")).Platform.OS = "android";
  });

  const renderSignIn = async ({ providers, socialSignIn }: Awaited<ReturnType<typeof shippedSocialSignIn>>) => {
    const backend = createFakeBackend();
    const client = createMobileAuthClient({
      backendUrl: TEST_BACKEND_URL,
      storage: createMemorySecureStore(),
      fetchImplementation: backend.fetchImplementation,
    });
    return await renderScreen(createElement(EmailEntryScreen, { client, onCodeSent: () => undefined, socialProviders: providers, socialSignIn }));
  };

  it("iOS never shows Google without Apple: with Apple off, iOS shows no social buttons", async () => {
    const screen = await renderSignIn(await shippedSocialSignIn("ios"));

    expect(screen.text()).not.toMatch(/Continue with (?:Apple|Google)/u);
    expect(screen.queryByLabelText("Continue with Google")).toBeNull();
    expect(screen.queryByText("Continue with email")).not.toBeNull();
  });

  it("Android with the same config shows Google (so the iOS check is not vacuous)", async () => {
    const screen = await renderSignIn(await shippedSocialSignIn("android"));

    expect(screen.queryByLabelText("Continue with Google")).not.toBeNull();
    expect(screen.queryByText("Continue with Apple")).toBeNull();
  });
});
