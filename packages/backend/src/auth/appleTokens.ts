import type { AuthCryptoCodec } from "./authSecrets.js";
import type { AppleProviderConfig } from "./socialProviders.js";

export const APPLE_TOKEN_ENDPOINT = "https://appleid.apple.com/auth/token";
export const APPLE_REVOKE_ENDPOINT = "https://appleid.apple.com/auth/revoke";

/** Marks an encrypted Apple refresh token in accounts.refresh_token, so the codec never encrypts it twice. */
export const APPLE_REFRESH_TOKEN_ENVELOPE_PREFIX = "apple-refresh:";

interface AppleRefreshTokenPayload {
  readonly refreshToken: string;
  /** The client the token was issued to (bundle id for native iOS). Null means the Services ID. */
  readonly clientId: string | null;
}

/** The only provider token kept: Apple's refresh token, encrypted, so account deletion can revoke it (App Store rule 5.1.1(v)). */
export function sealAppleRefreshToken(codec: AuthCryptoCodec, payload: AppleRefreshTokenPayload): string {
  return `${APPLE_REFRESH_TOKEN_ENVELOPE_PREFIX}${codec.encryptVerificationPayload(JSON.stringify(payload))}`;
}

export function openAppleRefreshToken(codec: AuthCryptoCodec, sealed: string): AppleRefreshTokenPayload | null {
  if (!sealed.startsWith(APPLE_REFRESH_TOKEN_ENVELOPE_PREFIX)) {
    return null;
  }
  const parsed = JSON.parse(
    codec.decryptVerificationPayload(sealed.slice(APPLE_REFRESH_TOKEN_ENVELOPE_PREFIX.length)),
  ) as Partial<AppleRefreshTokenPayload>;
  if (typeof parsed.refreshToken !== "string" || parsed.refreshToken === "") {
    return null;
  }
  return { refreshToken: parsed.refreshToken, clientId: typeof parsed.clientId === "string" ? parsed.clientId : null };
}

export interface AppleTokenClient {
  readonly config: AppleProviderConfig;
  readonly clientSecretFor: (clientId: string) => string;
}

/** Exchanges a native iOS authorization code (client = bundle id) for the refresh token. Returns null when Apple gives none. */
export async function exchangeNativeAppleAuthorizationCode(client: AppleTokenClient, authorizationCode: string): Promise<string | null> {
  const clientId = client.config.appBundleIdentifier;
  const response = await fetch(APPLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: client.clientSecretFor(clientId),
      code: authorizationCode,
      grant_type: "authorization_code",
    }),
  });
  if (!response.ok) {
    throw new Error(`Apple token exchange failed with status ${response.status}`);
  }
  const body = (await response.json()) as { refresh_token?: unknown };
  return typeof body.refresh_token === "string" && body.refresh_token !== "" ? body.refresh_token : null;
}

/** Revokes the stored Apple refresh token with the client it was issued to. Throws on any non-200 answer. */
export async function revokeAppleRefreshToken(client: AppleTokenClient, token: AppleRefreshTokenPayload): Promise<void> {
  const clientId = token.clientId ?? client.config.serviceId;
  const response = await fetch(APPLE_REVOKE_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: client.clientSecretFor(clientId),
      token: token.refreshToken,
      token_type_hint: "refresh_token",
    }),
  });
  if (!response.ok) {
    throw new Error(`Apple revoke failed with status ${response.status}`);
  }
}
