import { createPrivateKey, sign } from "node:crypto";
import type { BetterAuthOptions } from "better-auth/types";

export const GOOGLE_CLIENT_ID_ENV = "GOOGLE_CLIENT_ID";
export const GOOGLE_CLIENT_SECRET_ENV = "GOOGLE_CLIENT_SECRET";
export const APPLE_SERVICE_ID_ENV = "APPLE_SERVICE_ID";
export const APPLE_APP_BUNDLE_IDENTIFIER_ENV = "APPLE_APP_BUNDLE_IDENTIFIER";
export const APPLE_TEAM_ID_ENV = "APPLE_TEAM_ID";
export const APPLE_KEY_ID_ENV = "APPLE_KEY_ID";
export const APPLE_PRIVATE_KEY_ENV = "APPLE_PRIVATE_KEY";

export const GOOGLE_ENVIRONMENT_NAMES = [GOOGLE_CLIENT_ID_ENV, GOOGLE_CLIENT_SECRET_ENV] as const;
export const APPLE_ENVIRONMENT_NAMES = [
  APPLE_SERVICE_ID_ENV,
  APPLE_APP_BUNDLE_IDENTIFIER_ENV,
  APPLE_TEAM_ID_ENV,
  APPLE_KEY_ID_ENV,
  APPLE_PRIVATE_KEY_ENV,
] as const;

export interface GoogleProviderConfig {
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface AppleProviderConfig {
  readonly serviceId: string;
  readonly appBundleIdentifier: string;
  readonly teamId: string;
  readonly keyId: string;
  readonly privateKeyPem: string;
}

export interface SocialProviderConfig {
  readonly google?: GoogleProviderConfig;
  readonly apple?: AppleProviderConfig;
}

export interface SocialProviderRequirements {
  readonly requireGoogle?: boolean;
  readonly requireApple?: boolean;
}

type ProviderEnvironment = Readonly<Record<string, string | undefined>>;

function readProviderGroup<Name extends string>(
  env: ProviderEnvironment,
  names: readonly Name[],
  required: boolean,
): Record<Name, string> | undefined {
  const values = names.map((name) => [name, env[name]?.trim() ?? ""] as const);
  if (!required && values.every(([, value]) => value === "")) {
    return undefined;
  }
  const missing = values.find(([, value]) => value === "");
  if (missing) {
    throw new Error(`Missing required environment variable ${missing[0]}`);
  }
  return Object.fromEntries(values) as Record<Name, string>;
}

export function loadSocialProviderConfig(env: ProviderEnvironment, requirements: SocialProviderRequirements = {}): SocialProviderConfig {
  const google = readProviderGroup(env, GOOGLE_ENVIRONMENT_NAMES, requirements.requireGoogle === true);
  const apple = readProviderGroup(env, APPLE_ENVIRONMENT_NAMES, requirements.requireApple === true);
  return {
    ...(google ? { google: { clientId: google[GOOGLE_CLIENT_ID_ENV], clientSecret: google[GOOGLE_CLIENT_SECRET_ENV] } } : {}),
    ...(apple
      ? {
          apple: {
            serviceId: apple[APPLE_SERVICE_ID_ENV],
            appBundleIdentifier: apple[APPLE_APP_BUNDLE_IDENTIFIER_ENV],
            teamId: apple[APPLE_TEAM_ID_ENV],
            keyId: apple[APPLE_KEY_ID_ENV],
            privateKeyPem: apple[APPLE_PRIVATE_KEY_ENV].replaceAll("\\n", "\n"),
          },
        }
      : {}),
  };
}

const APPLE_CLIENT_SECRET_LIFETIME_SECONDS = 180 * 24 * 60 * 60;
const APPLE_CLIENT_SECRET_REFRESH_MARGIN_SECONDS = 24 * 60 * 60;

function encodeBase64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

export function createAppleClientSecret(config: AppleProviderConfig, clientId: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const header = encodeBase64Url(JSON.stringify({ alg: "ES256", kid: config.keyId }));
  const payload = encodeBase64Url(
    JSON.stringify({
      iss: config.teamId,
      iat: nowSeconds,
      exp: nowSeconds + APPLE_CLIENT_SECRET_LIFETIME_SECONDS,
      aud: "https://appleid.apple.com",
      sub: clientId,
    }),
  );
  const signature = sign("sha256", Buffer.from(`${header}.${payload}`), { key: createPrivateKey(config.privateKeyPem), dsaEncoding: "ieee-p1363" });
  return `${header}.${payload}.${encodeBase64Url(signature)}`;
}

export function createAppleClientSecretSource(config: AppleProviderConfig): (clientId: string) => string {
  const cache = new Map<string, { secret: string; renewAtSeconds: number }>();
  return (clientId) => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const cached = cache.get(clientId);
    if (cached && cached.renewAtSeconds > nowSeconds) {
      return cached.secret;
    }
    const secret = createAppleClientSecret(config, clientId, nowSeconds);
    cache.set(clientId, { secret, renewAtSeconds: nowSeconds + APPLE_CLIENT_SECRET_LIFETIME_SECONDS - APPLE_CLIENT_SECRET_REFRESH_MARGIN_SECONDS });
    return secret;
  };
}

export function buildSocialProviders(
  config: SocialProviderConfig,
  appleClientSecret?: (clientId: string) => string,
): NonNullable<BetterAuthOptions["socialProviders"]> {
  const providers: NonNullable<BetterAuthOptions["socialProviders"]> = {};
  if (config.google) {
    providers.google = {
      clientId: config.google.clientId,
      clientSecret: config.google.clientSecret,
      disableIdTokenSignIn: true,
      prompt: "select_account",
    };
  }
  if (config.apple) {
    const apple = config.apple;
    const secretFor = appleClientSecret ?? createAppleClientSecretSource(apple);
    providers.apple = {
      clientId: apple.serviceId,
      appBundleIdentifier: apple.appBundleIdentifier,
      audience: [apple.appBundleIdentifier, apple.serviceId],
      get clientSecret() {
        return secretFor(apple.serviceId);
      },
    };
  }
  return providers;
}
