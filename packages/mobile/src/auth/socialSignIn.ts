import { signUpAttestationVersion } from "@bjj-roll/shared";
import { AGE_GATE_REFUSAL_MESSAGE, type AgeAnswers, isAgeConfirmed, isSignUpAttestationAccepted } from "./ageConfirmation";
import { DEEP_LINK_SCHEME, type MobileAuthClient } from "./authClient";
import type { ExpoConfigWithExtra } from "./authConfig";
import {
  AGE_CONFIRMATION_REQUIRED_CODE,
  attestationRequired,
  failure,
  failureMessages,
  MAGIC_LINK_CALLBACK_URL,
  postAuth,
  SIGN_UP_ATTESTATION_REQUIRED_CODE,
  SOCIAL_SIGN_IN_CALLBACK_PATH,
  type ActionResult,
} from "./signInActions";

export type SocialProvider = "apple" | "google";

export const SOCIAL_SIGN_IN_CALLBACK_URL = `${MAGIC_LINK_CALLBACK_URL}${SOCIAL_SIGN_IN_CALLBACK_PATH}`;

const ACCOUNT_NOT_LINKED_ERROR = "account_not_linked";
const GOOGLE_NOT_LINKED_MESSAGE = "We couldn't sign you in with Google. Sign in with your email instead.";
const APPLE_CANCELED_CODE = "ERR_REQUEST_CANCELED";

export interface SocialSignInConfig {
  readonly appleEnabled: boolean;
  readonly googleEnabled: boolean;
}

export function readSocialSignInConfig(expoConfig: ExpoConfigWithExtra | null | undefined): SocialSignInConfig {
  const value = expoConfig?.extra?.socialSignIn;
  const flags = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  return { appleEnabled: flags.appleEnabled === true, googleEnabled: flags.googleEnabled === true };
}

export function visibleSocialProviders(config: SocialSignInConfig, platform: string): readonly SocialProvider[] {
  const isIos = platform === "ios";
  const showApple = config.appleEnabled && isIos;
  const showGoogle = config.googleEnabled && (!isIos || config.appleEnabled);
  return [...(showApple ? (["apple"] as const) : []), ...(showGoogle ? (["google"] as const) : [])];
}

export interface AuthBrowser {
  readonly openAuthSessionAsync: (url: string, redirectUrl: string) => Promise<{ readonly type: string; readonly url?: string }>;
}

export interface AppleNativeSignIn {
  readonly signInAsync: (hashedNonce: string) => Promise<{ readonly identityToken: string | null; readonly authorizationCode: string | null }>;
  readonly createNonce: () => string;
  readonly sha256Hex: (value: string) => Promise<string>;
}

export function socialNotLinked(provider: SocialProvider | null): ActionResult {
  return { ok: false, reason: "accountNotLinked", message: provider === "google" ? GOOGLE_NOT_LINKED_MESSAGE : failureMessages.accountNotLinked };
}

export interface SocialSignInDependencies {
  readonly client: MobileAuthClient;
  readonly backendUrl: string;
  readonly platform: string;
  readonly browser: AuthBrowser;
  readonly appleNative?: AppleNativeSignIn;
  readonly onReturned?: () => void;
}

const providerNames: Readonly<Record<SocialProvider, string>> = { apple: "Apple", google: "Google" };

export function socialFailureMessage(provider: SocialProvider, result: { readonly reason: string; readonly message: string | null }): string | null {
  return result.reason === "unknown" ? `Couldn't sign in with ${providerNames[provider]}. Try again.` : result.message;
}

const ignored: ActionResult = { ok: false, reason: "ignored", message: null };
const ageRequired: ActionResult = { ok: false, reason: "ageRequired", message: AGE_GATE_REFUSAL_MESSAGE };

interface SocialAgeAnswers {
  readonly age16Confirmed: true;
  readonly age18Confirmed: boolean;
  readonly signUpAttestationTextVersionId: string;
}

export async function signInWithProvider(
  dependencies: SocialSignInDependencies,
  provider: SocialProvider,
  answers: AgeAnswers,
): Promise<ActionResult> {
  if (!isAgeConfirmed(answers)) {
    return ageRequired;
  }
  if (!isSignUpAttestationAccepted(answers)) {
    return attestationRequired;
  }
  const ages: SocialAgeAnswers = {
    age16Confirmed: true,
    age18Confirmed: answers.age18Confirmed === true,
    signUpAttestationTextVersionId: signUpAttestationVersion.id,
  };
  if (provider === "google") {
    return await signInWithGoogle(dependencies, ages);
  }
  return dependencies.platform === "ios" && dependencies.appleNative
    ? await signInWithAppleNative(dependencies, dependencies.appleNative, ages)
    : failure("unknown");
}

async function signInWithAppleNative(
  { client, onReturned }: SocialSignInDependencies,
  appleNative: AppleNativeSignIn,
  ages: SocialAgeAnswers,
): Promise<ActionResult> {
  const nonce = appleNative.createNonce();
  let credential: Awaited<ReturnType<AppleNativeSignIn["signInAsync"]>>;
  try {
    credential = await appleNative.signInAsync(await appleNative.sha256Hex(nonce));
  } catch (error) {
    return (error as { code?: unknown } | null)?.code === APPLE_CANCELED_CODE ? ignored : failure("unknown");
  }
  if (!credential.identityToken) {
    return failure("unknown");
  }
  onReturned?.();
  return await postAuth(client, {
    path: "/sign-in/social",
    body: {
      provider: "apple",
      idToken: { token: credential.identityToken, nonce },
      additionalData: { ...ages, ...(credential.authorizationCode ? { appleAuthorizationCode: credential.authorizationCode } : {}) },
    },
  });
}

async function signInWithGoogle(dependencies: SocialSignInDependencies, ages: SocialAgeAnswers): Promise<ActionResult> {
  let authorizationUrl: unknown;
  try {
    const { data, error } = await dependencies.client.$fetch<{ url?: unknown }>("/sign-in/social", {
      method: "POST",
      body: {
        provider: "google",
        callbackURL: SOCIAL_SIGN_IN_CALLBACK_URL,
        errorCallbackURL: SOCIAL_SIGN_IN_CALLBACK_URL,
        disableRedirect: true,
        additionalData: ages,
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
  const proxyQuery = new URLSearchParams({ authorizationURL: authorizationUrl }).toString();
  const proxyUrl = `${dependencies.backendUrl}/api/auth/expo-authorization-proxy?${proxyQuery}`;
  const result = await dependencies.browser.openAuthSessionAsync(proxyUrl, `${DEEP_LINK_SCHEME}://auth`);
  if (result.type !== "success" || !result.url) {
    return ignored;
  }
  dependencies.onReturned?.();
  return await completeSocialSignIn(dependencies.client, result.url, "google");
}

export async function completeSocialSignIn(client: MobileAuthClient, url: string, provider: SocialProvider | null = null): Promise<ActionResult> {
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
  if (error === SIGN_UP_ATTESTATION_REQUIRED_CODE) {
    return attestationRequired;
  }
  if (error === ACCOUNT_NOT_LINKED_ERROR) {
    return socialNotLinked(provider);
  }
  const code = parsed.searchParams.get("code");
  if (error || !code) {
    return failure("unknown");
  }
  return await postAuth(client, { path: "/magic-link/exchange", body: { code }, clientErrorReason: "invalidLink" });
}
