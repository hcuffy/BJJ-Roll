import { AGE_GATE_REFUSAL_MESSAGE } from "./ageConfirmation";
import { DEEP_LINK_SCHEME, type MobileAuthClient } from "./authClient";
import type { ExpoConfigWithExtra } from "./authConfig";
import {
  AGE_CONFIRMATION_REQUIRED_CODE,
  failure,
  MAGIC_LINK_CALLBACK_URL,
  postAuth,
  SOCIAL_SIGN_IN_CALLBACK_PATH,
  type ActionResult,
} from "./signInActions";

export type SocialProvider = "apple" | "google";

/** Where the backend sends the browser back with a one-time code (or an error). Must stay a bjjroll://auth deep link. */
export const SOCIAL_SIGN_IN_CALLBACK_URL = `${MAGIC_LINK_CALLBACK_URL}${SOCIAL_SIGN_IN_CALLBACK_PATH}`;

/** Better Auth's error code when the email already belongs to an account the provider could not prove it owns. */
export const ACCOUNT_NOT_LINKED_ERROR = "account_not_linked";
/** expo-apple-authentication's rejection code when the user closes the Apple sheet. */
const APPLE_CANCELED_CODE = "ERR_REQUEST_CANCELED";

export interface SocialSignInConfig {
  readonly appleEnabled: boolean;
  readonly googleEnabled: boolean;
}

/** Expo config `extra.socialSignIn` (app.json). Anything but `true` keeps a provider off, so Apple stays off until it is turned on. */
export function readSocialSignInConfig(expoConfig: ExpoConfigWithExtra | null | undefined): SocialSignInConfig {
  const value = expoConfig?.extra?.socialSignIn;
  const flags = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  return { appleEnabled: flags.appleEnabled === true, googleEnabled: flags.googleEnabled === true };
}

/** Buttons to show. App Store rule 4.8: an iOS app that offers Google sign-in must offer Apple too, so iOS shows Google only next to Apple. */
export function visibleSocialProviders(config: SocialSignInConfig, platform: string): readonly SocialProvider[] {
  const showGoogle = config.googleEnabled && (platform !== "ios" || config.appleEnabled);
  return [...(config.appleEnabled ? (["apple"] as const) : []), ...(showGoogle ? (["google"] as const) : [])];
}

/** expo-web-browser's auth session, narrowed to what sign-in uses. */
export interface AuthBrowser {
  readonly openAuthSessionAsync: (url: string, redirectUrl: string) => Promise<{ readonly type: string; readonly url?: string }>;
}

/** expo-apple-authentication, narrowed to what sign-in uses (iOS only). */
export interface AppleNativeSignIn {
  readonly signInAsync: () => Promise<{ readonly identityToken: string | null; readonly authorizationCode: string | null }>;
}

export interface SocialSignInDependencies {
  readonly client: MobileAuthClient;
  readonly backendUrl: string;
  readonly platform: string;
  readonly browser: AuthBrowser;
  readonly appleNative?: AppleNativeSignIn;
}

const ignored: ActionResult = { ok: false, reason: "ignored", message: null };
const ageRequired: ActionResult = { ok: false, reason: "ageRequired", message: AGE_GATE_REFUSAL_MESSAGE };

/** Signs in with Apple (native sheet on iOS) or Google (browser). Nothing is sent unless the 17+ box is ticked. Closing the sheet is not an error. */
export async function signInWithProvider(
  dependencies: SocialSignInDependencies,
  provider: SocialProvider,
  ageConfirmed: boolean,
): Promise<ActionResult> {
  if (!ageConfirmed) {
    return ageRequired;
  }
  if (provider === "apple" && dependencies.platform === "ios" && dependencies.appleNative) {
    return await signInWithAppleNative(dependencies.client, dependencies.appleNative);
  }
  return await signInWithBrowser(dependencies, provider);
}

async function signInWithAppleNative(client: MobileAuthClient, appleNative: AppleNativeSignIn): Promise<ActionResult> {
  let credential: Awaited<ReturnType<AppleNativeSignIn["signInAsync"]>>;
  try {
    credential = await appleNative.signInAsync();
  } catch (error) {
    return (error as { code?: unknown } | null)?.code === APPLE_CANCELED_CODE ? ignored : failure("unknown");
  }
  if (!credential.identityToken) {
    return failure("unknown");
  }
  // The authorization code lets the backend get Apple's refresh token, which account deletion revokes (App Store rule 5.1.1(v)).
  return await postAuth(client, {
    path: "/sign-in/social",
    body: {
      provider: "apple",
      idToken: { token: credential.identityToken },
      additionalData: { ageConfirmed: true, ...(credential.authorizationCode ? { appleAuthorizationCode: credential.authorizationCode } : {}) },
    },
  });
}

async function signInWithBrowser(dependencies: SocialSignInDependencies, provider: SocialProvider): Promise<ActionResult> {
  let authorizationUrl: unknown;
  try {
    const { data, error } = await dependencies.client.$fetch<{ url?: unknown }>("/sign-in/social", {
      method: "POST",
      // disableRedirect: the app opens the browser itself so it can read the one-time code (the Expo plugin only reads cookies).
      body: {
        provider,
        callbackURL: SOCIAL_SIGN_IN_CALLBACK_URL,
        errorCallbackURL: SOCIAL_SIGN_IN_CALLBACK_URL,
        disableRedirect: true,
        additionalData: { ageConfirmed: true },
      },
    });
    if (error) {
      return error.status === 429 ? failure("rateLimited") : failure("unknown");
    }
    authorizationUrl = data?.url;
  } catch {
    return failure("network");
  }
  if (typeof authorizationUrl !== "string") {
    return failure("unknown");
  }
  // The Expo server plugin sets the state cookie in the browser, then forwards to the provider.
  const proxyQuery = new URLSearchParams({ authorizationURL: authorizationUrl }).toString();
  const proxyUrl = `${dependencies.backendUrl}/api/auth/expo-authorization-proxy?${proxyQuery}`;
  const result = await dependencies.browser.openAuthSessionAsync(proxyUrl, `${DEEP_LINK_SCHEME}://auth`);
  if (result.type !== "success" || !result.url) {
    return ignored;
  }
  return await completeSocialSignIn(dependencies.client, result.url);
}

/** Reads the browser's return URL: a one-time code becomes a session; a backend error becomes plain copy. */
export async function completeSocialSignIn(client: MobileAuthClient, url: string): Promise<ActionResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return failure("unknown");
  }
  if (`${parsed.protocol}//${parsed.host}${parsed.pathname}` !== SOCIAL_SIGN_IN_CALLBACK_URL) {
    return failure("unknown");
  }
  const error = parsed.searchParams.get("error");
  if (error === AGE_CONFIRMATION_REQUIRED_CODE) {
    return ageRequired;
  }
  if (error === ACCOUNT_NOT_LINKED_ERROR) {
    return failure("accountNotLinked");
  }
  const code = parsed.searchParams.get("code");
  if (error || !code) {
    return failure("unknown");
  }
  return await postAuth(client, { path: "/magic-link/exchange", body: { code }, clientErrorReason: "invalidLink" });
}
