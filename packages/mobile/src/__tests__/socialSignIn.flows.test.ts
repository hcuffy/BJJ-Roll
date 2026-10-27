/// <reference types="node" />
import { createHash } from "node:crypto";
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

const sha256Hex = (value: string): string => createHash("sha256").update(value).digest("hex");
const NEUTRAL_GOOGLE_COPY = "We couldn't sign you in with Google. Sign in with your email instead.";
const NEUTRAL_COPY = "We couldn't sign you in this way. Sign in with your email instead.";
/** The same answers the email and code screens send (HEN-263): 16+ ticked, 18+ not. */
const AGE_16 = { age16Confirmed: true, age18Confirmed: false } as const;

/** A fake Apple sheet with a fixed raw nonce; hashing is real SHA-256 so the test sees what Apple would get. */
function fakeAppleNative(signInAsync: AppleNativeSignIn["signInAsync"], rawNonce = "raw-nonce-0123456789abcdef") {
  return { signInAsync: vi.fn(signInAsync), createNonce: () => rawNonce, sha256Hex: (value: string) => Promise.resolve(sha256Hex(value)) };
}

function createTestDependencies(
  options: {
    platform?: string;
    browserResult?: { type: string; url?: string };
    appleNative?: AppleNativeSignIn;
    nativeSignInRefusal?: { status: number; body: unknown };
  } = {},
) {
  const backend = createFakeBackend({ nativeSignInRefusal: options.nativeSignInRefusal });
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
  it("sends nothing and shows the 16+ message when the 16+ box is not ticked, even with 18+ ticked", async () => {
    const { backend, browser, dependencies } = createTestDependencies();

    for (const provider of ["google", "apple"] as const) {
      for (const answers of [{ age16Confirmed: false }, { age16Confirmed: false, age18Confirmed: true }]) {
        expect(await signInWithProvider(dependencies, provider, answers)).toEqual({
          ok: false,
          reason: "ageRequired",
          message: "You must be 16 or older to sign up.",
        });
      }
    }
    expect(backend.fetchImplementation).not.toHaveBeenCalled();
    expect(browser.openAuthSessionAsync).not.toHaveBeenCalled();
  });

  it("sends the 18+ answer as given, like the email screen", async () => {
    const { backend, dependencies } = createTestDependencies();

    expect(await signInWithProvider(dependencies, "google", { age16Confirmed: true, age18Confirmed: true })).toEqual({ ok: true });
    expect(backend.requests[0]?.body).toMatchObject({ additionalData: { age16Confirmed: true, age18Confirmed: true } });
  });

  it("Google: sends the 16+ and 18+ answers, opens the provider URL through the Expo proxy, and swaps the returned code for a session", async () => {
    const { backend, browser, storage, dependencies } = createTestDependencies();

    expect(await signInWithProvider(dependencies, "google", AGE_16)).toEqual({ ok: true });

    expect(backend.requests[0]?.url).toBe(`${TEST_BACKEND_URL}/api/auth/sign-in/social`);
    expect(backend.requests[0]?.body).toEqual({
      provider: "google",
      callbackURL: "bjjroll://auth/social",
      errorCallbackURL: "bjjroll://auth/social",
      disableRedirect: true,
      additionalData: { age16Confirmed: true, age18Confirmed: false },
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

  it("shows the 16+ message, the neutral not-linked message, or nothing (closed browser) from the browser's return", async () => {
    const cases = [
      [{ type: "success", url: `${SOCIAL_SIGN_IN_CALLBACK_URL}?error=AGE_CONFIRMATION_REQUIRED&error_description=x` }, "ageRequired"],
      [{ type: "success", url: `${SOCIAL_SIGN_IN_CALLBACK_URL}?error=account_not_linked` }, "accountNotLinked"],
      [{ type: "success", url: `${SOCIAL_SIGN_IN_CALLBACK_URL}?error=please_restart_the_process` }, "unknown"],
      [{ type: "success", url: "bjjroll://elsewhere/social?code=one-time-code" }, "unknown"],
      [{ type: "cancel" }, "ignored"],
    ] as const;
    for (const [browserResult, reason] of cases) {
      const { backend, dependencies } = createTestDependencies({ browserResult });
      const result = await signInWithProvider(dependencies, "google", AGE_16);
      expect(result).toMatchObject({ ok: false, reason });
      expect(backend.requests.map((request) => new URL(request.url).pathname)).toEqual(["/api/auth/sign-in/social"]);
    }
  });

  it("Apple on iOS: native sheet with SHA-256(nonce), then posts the identity token, raw nonce, age answers and code (no browser)", async () => {
    const appleNative = fakeAppleNative(() => Promise.resolve({ identityToken: "fake.identity.token", authorizationCode: "fake-apple-code" }));
    const { backend, browser, storage, dependencies } = createTestDependencies({ platform: "ios", appleNative });

    expect(await signInWithProvider(dependencies, "apple", AGE_16)).toEqual({ ok: true });

    expect(appleNative.signInAsync).toHaveBeenCalledWith(sha256Hex("raw-nonce-0123456789abcdef"));
    expect(backend.requests[0]?.body).toEqual({
      provider: "apple",
      idToken: { token: "fake.identity.token", nonce: "raw-nonce-0123456789abcdef" },
      additionalData: { age16Confirmed: true, age18Confirmed: false, appleAuthorizationCode: "fake-apple-code" },
    });
    expect(browser.openAuthSessionAsync).not.toHaveBeenCalled();
    expect(storage.items.get("bjjroll_cookie")).toContain("signed-session-value");
  });

  it("Apple on iOS: closing the sheet is silent; the backend's age refusal shows the 16+ message", async () => {
    const canceled = fakeAppleNative(() => Promise.reject(Object.assign(new Error("canceled"), { code: "ERR_REQUEST_CANCELED" })));
    const closed = createTestDependencies({ platform: "ios", appleNative: canceled });
    expect(await signInWithProvider(closed.dependencies, "apple", AGE_16)).toEqual({ ok: false, reason: "ignored", message: null });
    expect(closed.backend.fetchImplementation).not.toHaveBeenCalled();

    const signedIn = fakeAppleNative(() => Promise.resolve({ identityToken: "fake.identity.token", authorizationCode: null }));
    const refusal = { status: 400, body: { code: "AGE_CONFIRMATION_REQUIRED", message: "x" } };
    const refused = createTestDependencies({ platform: "ios", appleNative: signedIn, nativeSignInRefusal: refusal });
    expect(await signInWithProvider(refused.dependencies, "apple", AGE_16)).toEqual({
      ok: false,
      reason: "ageRequired",
      message: AGE_GATE_REFUSAL_MESSAGE,
    });
  });

  it("Apple on iOS: the backend's refusal of an unverified email shows the same neutral copy as the browser flow", async () => {
    const appleNative = fakeAppleNative(() => Promise.resolve({ identityToken: "fake.identity.token", authorizationCode: null }));
    const refusal = { status: 401, body: { code: "OAUTH_LINK_ERROR", message: "account not linked" } };
    const { dependencies } = createTestDependencies({ platform: "ios", appleNative, nativeSignInRefusal: refusal });

    expect(await signInWithProvider(dependencies, "apple", AGE_16)).toEqual({ ok: false, reason: "accountNotLinked", message: NEUTRAL_COPY });
  });

  it("names Google in the neutral refusal only for Google; Apple's browser flow gets the general copy", async () => {
    const browserResult = { type: "success", url: `${SOCIAL_SIGN_IN_CALLBACK_URL}?error=account_not_linked` };
    const google = createTestDependencies({ browserResult });
    const apple = createTestDependencies({ browserResult, platform: "android" });

    expect(await signInWithProvider(google.dependencies, "google", AGE_16)).toEqual({
      ok: false,
      reason: "accountNotLinked",
      message: NEUTRAL_GOOGLE_COPY,
    });
    expect(await signInWithProvider(apple.dependencies, "apple", AGE_16)).toEqual({ ok: false, reason: "accountNotLinked", message: NEUTRAL_COPY });
  });

  it("Apple on Android uses the browser flow", async () => {
    const { backend, browser, dependencies } = createTestDependencies({ platform: "android" });

    expect(await signInWithProvider(dependencies, "apple", AGE_16)).toEqual({ ok: true });
    expect(backend.requests[0]?.body).toMatchObject({
      provider: "apple",
      disableRedirect: true,
      additionalData: { age16Confirmed: true, age18Confirmed: false },
    });
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

  it("on iOS shows Google only next to Apple (App Store rule 4.8); Android never shows Apple (Henry, 27 Oct)", () => {
    expect(visibleSocialProviders({ appleEnabled: false, googleEnabled: true }, "ios")).toEqual([]);
    expect(visibleSocialProviders({ appleEnabled: true, googleEnabled: true }, "ios")).toEqual(["apple", "google"]);
    expect(visibleSocialProviders({ appleEnabled: false, googleEnabled: true }, "android")).toEqual(["google"]);
    expect(visibleSocialProviders({ appleEnabled: true, googleEnabled: true }, "android")).toEqual(["google"]);
    expect(visibleSocialProviders({ appleEnabled: true, googleEnabled: false }, "android")).toEqual([]);
  });
});
