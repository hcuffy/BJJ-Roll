import { getOAuthState, type createAuthMiddleware } from "better-auth/api";
import type { Pool } from "pg";
import { readSocialSignUpAgeAnswers, refreshSignUpAttestationAfterSignIn, type SocialSignUpAgeAnswers } from "./ageGate.js";
import {
  exchangeNativeAppleAuthorizationCode,
  openAppleRefreshToken,
  revokeAppleRefreshToken,
  sealAppleRefreshToken,
  type AppleTokenClient,
} from "./appleTokens.js";
import type { AuthCryptoCodec } from "./authSecrets.js";
import { createAppleClientSecretSource, type AppleProviderConfig } from "./socialProviders.js";
import { neutralizeAccountNotLinkedRedirect } from "./socialSignInSafety.js";

export type AuthEventName = "apple_refresh_token_missing" | "signup_attestation_refresh_failed";

export type AuthEventLogger = (event: AuthEventName, userId: string) => void;

const defaultLogAuthEvent: AuthEventLogger = (event, userId) => {
  process.stdout.write(`${JSON.stringify({ event, userId })}\n`);
};

const MAX_APPLE_AUTHORIZATION_CODE_LENGTH = 1024;

type AuthMiddlewareContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

interface UserCreateHookContext {
  readonly path?: string;
  readonly body?: unknown;
}

/** HEN-239: in the user-create hook, the 16+ and 18+ answers of an Apple or Google sign-up (request body or OAuth state). */
export async function socialSignUpAgeAnswers(hookContext: UserCreateHookContext | null | undefined): Promise<SocialSignUpAgeAnswers> {
  const oauthState = hookContext?.path?.startsWith("/callback/") ? await getOAuthState() : null;
  return readSocialSignUpAgeAnswers(hookContext?.path, hookContext?.body, oauthState);
}

function readAppleAuthorizationCode(body: Record<string, unknown>): string | null {
  const additionalData = body.additionalData;
  const code =
    typeof additionalData === "object" && additionalData !== null ? (additionalData as Record<string, unknown>).appleAuthorizationCode : undefined;
  return typeof code === "string" && code.length > 0 && code.length <= MAX_APPLE_AUTHORIZATION_CODE_LENGTH ? code : null;
}

export interface AppleSignInCapture {
  readonly appleTokenClient: AppleTokenClient | null;
  readonly codec: AuthCryptoCodec;
  readonly logAuthEvent: AuthEventLogger;
}

export function createAppleSignInCapture(
  appleConfig: AppleProviderConfig | undefined,
  codec: AuthCryptoCodec,
  logAuthEvent: AuthEventLogger = defaultLogAuthEvent,
): AppleSignInCapture {
  const appleTokenClient = appleConfig ? { config: appleConfig, clientSecretFor: createAppleClientSecretSource(appleConfig) } : null;
  return { appleTokenClient, codec, logAuthEvent };
}

/** Revokes a stored, sealed Apple refresh token; throws when Apple is not configured, the value cannot be opened, or Apple refuses. */
export async function revokeSealedAppleRefreshToken(capture: AppleSignInCapture, sealedRefreshToken: string): Promise<void> {
  const token = openAppleRefreshToken(capture.codec, sealedRefreshToken);
  if (!capture.appleTokenClient || !token) {
    throw new Error("Apple refresh token cannot be revoked");
  }
  await revokeAppleRefreshToken(capture.appleTokenClient, token);
}

/**
 * The after hook: neutral account_not_linked redirects first (HEN-239), then the Apple refresh-token capture, then (HEN-183) the
 * sign-in duties tick for an existing account.
 */
export async function afterAuthRequest(middlewareContext: AuthMiddlewareContext, capture: AppleSignInCapture, pool: Pool): Promise<void> {
  neutralizeAccountNotLinkedRedirect(middlewareContext);
  await captureAppleRefreshToken(middlewareContext, capture);
  await refreshSignUpAttestation(middlewareContext, capture, pool);
}

/** A failed write never undoes the sign-in: the app's status read then shows the re-accept prompt. Logged by user id only. */
async function refreshSignUpAttestation(middlewareContext: AuthMiddlewareContext, capture: AppleSignInCapture, pool: Pool): Promise<void> {
  const user = middlewareContext.context.newSession?.user;
  if (!user) {
    return;
  }
  try {
    const oauthState = middlewareContext.path.startsWith("/callback/") ? await getOAuthState() : null;
    await refreshSignUpAttestationAfterSignIn(pool, capture.codec, { path: middlewareContext.path, user, body: middlewareContext.body, oauthState });
  } catch {
    capture.logAuthEvent("signup_attestation_refresh_failed", user.id);
  }
}

/**
 * After-hook for native iOS Apple sign-in: the id token proves who it is; the authorization code is exchanged once for the refresh
 * token that account deletion revokes. A failed exchange never blocks sign-in; it is logged by user id only.
 */
export async function captureAppleRefreshToken(middlewareContext: AuthMiddlewareContext, capture: AppleSignInCapture): Promise<void> {
  const { appleTokenClient, codec, logAuthEvent } = capture;
  if (middlewareContext.path !== "/sign-in/social" || !appleTokenClient) {
    return;
  }
  const body = middlewareContext.body as Record<string, unknown> | undefined;
  const userId = middlewareContext.context.newSession?.user.id;
  if (body?.provider !== "apple" || typeof body.idToken !== "object" || !userId) {
    return;
  }
  const authorizationCode = readAppleAuthorizationCode(body);
  if (!authorizationCode) {
    logAuthEvent("apple_refresh_token_missing", userId);
    return;
  }
  try {
    const refreshToken = await exchangeNativeAppleAuthorizationCode(appleTokenClient, authorizationCode);
    const appleAccount = (await middlewareContext.context.internalAdapter.findAccounts(userId)).find((account) => account.providerId === "apple");
    if (!refreshToken || !appleAccount) {
      logAuthEvent("apple_refresh_token_missing", userId);
      return;
    }
    // Scoped by user id as well as row id: the accounts RLS policy only shows the owner's rows.
    await middlewareContext.context.adapter.update({
      model: "account",
      where: [
        { field: "id", value: appleAccount.id },
        { field: "userId", value: userId },
      ],
      update: {
        providerId: "apple",
        refreshToken: sealAppleRefreshToken(codec, { refreshToken, clientId: appleTokenClient.config.appBundleIdentifier }),
      },
    });
  } catch {
    logAuthEvent("apple_refresh_token_missing", userId);
  }
}
