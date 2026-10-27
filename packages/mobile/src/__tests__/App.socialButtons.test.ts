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
async function shippedSocialSignIn(
  platform: string,
  expoConfig: unknown = appConfig.expo,
): Promise<{ providers: readonly SocialProvider[]; socialSignIn: SocialSignInDependencies }> {
  vi.resetModules();
  vi.doMock("expo-constants", () => ({ default: { expoConfig } }));
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
    expect(screen.queryByLabelText("Sign in with Google")).toBeNull();
    expect(screen.queryByText("Continue with email")).not.toBeNull();
  });

  it("Android with the same config shows Google (so the iOS check is not vacuous)", async () => {
    const screen = await renderSignIn(await shippedSocialSignIn("android"));

    expect(screen.queryByLabelText("Sign in with Google")).not.toBeNull();
    expect(screen.queryByText("Continue with Apple")).toBeNull();
  });

  describe("with Apple turned on (Henry, 27 Oct: Android hides Apple)", () => {
    const appleOn = { ...appConfig.expo, extra: { ...appConfig.expo.extra, socialSignIn: { appleEnabled: true, googleEnabled: true } } };

    it("Android renders Google only and no Apple button", async () => {
      const screen = await renderSignIn(await shippedSocialSignIn("android", appleOn));

      expect(screen.queryByLabelText("Sign in with Google")).not.toBeNull();
      expect(screen.findAllByType("AppleAuthenticationButton")).toHaveLength(0);
      expect(screen.text()).not.toMatch(/Apple/u);
    });

    it("iOS still shows Apple's native button, before Google", async () => {
      const screen = await renderSignIn(await shippedSocialSignIn("ios", appleOn));
      const [apple, ...others] = screen.findAllByType("AppleAuthenticationButton");

      expect(others).toHaveLength(0);
      expect(screen.pressables().indexOf(apple!)).toBeLessThan(screen.pressables().indexOf(screen.getPressable("Sign in with Google")));
    });
  });
});
