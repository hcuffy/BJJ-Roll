import { AGE_GATE_REFUSAL_MESSAGE } from "@bjj-roll/shared";
import { describe, expect, it, vi } from "vitest";
import { createMobileAuthClient } from "../auth/authClient";
import { completeMagicLink } from "../auth/signInActions";
import {
  readSocialSignInConfig,
  signInWithProvider,
  SOCIAL_SIGN_IN_CALLBACK_URL,
  visibleSocialProviders,
  type AppleNativeSignIn,
  type AuthBrowser,
} from "../auth/socialSignIn";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL, TEST_PROVIDER_AUTHORIZATION_URL } from "./authTestDoubles";
import appConfig from "../../app.json";

function createTestDependencies(
  options: { platform?: string; browserResult?: { type: string; url?: string }; appleNative?: AppleNativeSignIn } = {},
) {
  const backend = createFakeBackend();
  const storage = createMemorySecureStore();
  const client = createMobileAuthClient({ backendUrl: TEST_BACKEND_URL, storage, fetchImplementation: backend.fetchImplementation });
  const browser = {
    openAuthSessionAsync: vi.fn<AuthBrowser["openAuthSessionAsync"]>(() =>
      Promise.resolve(options.browserResult ?? { type: "success", url: `${SOCIAL_SIGN_IN_CALLBACK_URL}?code=one-time-code` }),
    ),
  };
  const dependencies = { client, backendUrl: TEST_BACKEND_URL, platform: options.platform ?? "android", browser, appleNative: options.appleNative };
  return { backend, storage, browser, dependencies };
}

describe("HEN-239 Apple and Google sign-in on the phone", () => {
  it("sends nothing and shows the 17+ message when the box is not ticked", async () => {
    const { backend, browser, dependencies } = createTestDependencies();

    for (const provider of ["google", "apple"] as const) {
      expect(await signInWithProvider(dependencies, provider, false)).toEqual({
        ok: false,
        reason: "ageRequired",
        message: AGE_GATE_REFUSAL_MESSAGE,
      });
    }
    expect(backend.fetchImplementation).not.toHaveBeenCalled();
    expect(browser.openAuthSessionAsync).not.toHaveBeenCalled();
  });

  it("Google: asks for the provider URL with ageConfirmed, opens it through the Expo proxy, and swaps the returned code for a session", async () => {
    const { backend, browser, storage, dependencies } = createTestDependencies();

    expect(await signInWithProvider(dependencies, "google", true)).toEqual({ ok: true });

    expect(backend.requests[0]?.url).toBe(`${TEST_BACKEND_URL}/api/auth/sign-in/social`);
    expect(backend.requests[0]?.body).toEqual({
      provider: "google",
      callbackURL: "bjjroll://auth/social",
      errorCallbackURL: "bjjroll://auth/social",
      disableRedirect: true,
      additionalData: { ageConfirmed: true },
    });
    const [proxyUrl, redirectUrl] = browser.openAuthSessionAsync.mock.calls[0] ?? [];
    const proxy = new URL(proxyUrl ?? "");
    expect(`${proxy.origin}${proxy.pathname}`).toBe(`${TEST_BACKEND_URL}/api/auth/expo-authorization-proxy`);
    expect(proxy.searchParams.get("authorizationURL")).toBe(`${TEST_PROVIDER_AUTHORIZATION_URL}&provider=google`);
    expect(redirectUrl).toBe("bjjroll://auth");
    expect(backend.requests[1]?.url).toBe(`${TEST_BACKEND_URL}/api/auth/magic-link/exchange`);
    expect(backend.requests[1]?.body).toEqual({ code: "one-time-code" });
    expect(storage.items.get("bjjroll_cookie")).toContain("signed-session-value");
  });

  it("shows the 17+ message, the existing-account message, or nothing (closed browser) from the browser's return", async () => {
    const cases = [
      [{ type: "success", url: `${SOCIAL_SIGN_IN_CALLBACK_URL}?error=AGE_CONFIRMATION_REQUIRED&error_description=x` }, "ageRequired"],
      [{ type: "success", url: `${SOCIAL_SIGN_IN_CALLBACK_URL}?error=account_not_linked` }, "accountNotLinked"],
      [{ type: "success", url: `${SOCIAL_SIGN_IN_CALLBACK_URL}?error=please_restart_the_process` }, "unknown"],
      [{ type: "success", url: "bjjroll://elsewhere/social?code=one-time-code" }, "unknown"],
      [{ type: "cancel" }, "ignored"],
    ] as const;
    for (const [browserResult, reason] of cases) {
      const { backend, dependencies } = createTestDependencies({ browserResult });
      const result = await signInWithProvider(dependencies, "google", true);
      expect(result).toMatchObject({ ok: false, reason });
      expect(backend.requests.map((request) => new URL(request.url).pathname)).toEqual(["/api/auth/sign-in/social"]);
    }
  });

  it("Apple on iOS: native sheet, then posts the identity token, ageConfirmed and the authorization code (no browser)", async () => {
    const appleNative = { signInAsync: vi.fn(() => Promise.resolve({ identityToken: "fake.identity.token", authorizationCode: "fake-apple-code" })) };
    const { backend, browser, storage, dependencies } = createTestDependencies({ platform: "ios", appleNative });

    expect(await signInWithProvider(dependencies, "apple", true)).toEqual({ ok: true });

    expect(backend.requests[0]?.body).toEqual({
      provider: "apple",
      idToken: { token: "fake.identity.token" },
      additionalData: { ageConfirmed: true, appleAuthorizationCode: "fake-apple-code" },
    });
    expect(browser.openAuthSessionAsync).not.toHaveBeenCalled();
    expect(storage.items.get("bjjroll_cookie")).toContain("signed-session-value");
  });

  it("Apple on iOS: closing the sheet is silent; the backend's age refusal shows the 17+ message", async () => {
    const canceled = { signInAsync: () => Promise.reject(Object.assign(new Error("canceled"), { code: "ERR_REQUEST_CANCELED" })) };
    const closed = createTestDependencies({ platform: "ios", appleNative: canceled });
    expect(await signInWithProvider(closed.dependencies, "apple", true)).toEqual({ ok: false, reason: "ignored", message: null });
    expect(closed.backend.fetchImplementation).not.toHaveBeenCalled();
  });

  it("Apple on Android uses the browser flow", async () => {
    const { backend, browser, dependencies } = createTestDependencies({ platform: "android" });

    expect(await signInWithProvider(dependencies, "apple", true)).toEqual({ ok: true });
    expect(backend.requests[0]?.body).toMatchObject({ provider: "apple", disableRedirect: true, additionalData: { ageConfirmed: true } });
    expect(browser.openAuthSessionAsync).toHaveBeenCalledOnce();
  });

  it("the deep-link handler leaves the social return to the browser session, so a code is never exchanged twice", async () => {
    const { backend, dependencies } = createTestDependencies();

    expect(await completeMagicLink(dependencies.client, `${SOCIAL_SIGN_IN_CALLBACK_URL}?code=one-time-code`)).toEqual({
      ok: false,
      reason: "ignored",
      message: null,
    });
    expect(backend.fetchImplementation).not.toHaveBeenCalled();
  });
});

describe("HEN-239 which sign-in buttons show", () => {
  it("ships with Google on and Apple off until Henry's Apple account is set up", () => {
    expect(readSocialSignInConfig(appConfig.expo)).toEqual({ appleEnabled: false, googleEnabled: true });
    expect(appConfig.expo.ios).toMatchObject({ usesAppleSignIn: true });
    expect(appConfig.expo.plugins).toContain("expo-apple-authentication");
  });

  it("keeps a provider off unless its flag is exactly true", () => {
    expect(readSocialSignInConfig(undefined)).toEqual({ appleEnabled: false, googleEnabled: false });
    expect(readSocialSignInConfig({ extra: { socialSignIn: { appleEnabled: "true", googleEnabled: 1 } } })).toEqual({
      appleEnabled: false,
      googleEnabled: false,
    });
  });

  it("on iOS shows Google only next to Apple (App Store rule 4.8); Android shows what is on", () => {
    expect(visibleSocialProviders({ appleEnabled: false, googleEnabled: true }, "ios")).toEqual([]);
    expect(visibleSocialProviders({ appleEnabled: true, googleEnabled: true }, "ios")).toEqual(["apple", "google"]);
    expect(visibleSocialProviders({ appleEnabled: false, googleEnabled: true }, "android")).toEqual(["google"]);
    expect(visibleSocialProviders({ appleEnabled: true, googleEnabled: false }, "android")).toEqual(["apple"]);
  });
});
