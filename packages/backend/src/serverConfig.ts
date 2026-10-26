import type { Keyring } from "@bjj-roll/shared/encryption";
import { loadSocialProviderConfig, type SocialProviderConfig } from "./auth/socialProviders.js";
import { loadAuthKeyringFromEnvironment, TRUSTABLE_PROXY_IP_HEADERS, type AuthSecretEnvironment, type TrustableProxyIpHeader } from "./auth/index.js";

export const DATABASE_URL_ENV = "DATABASE_URL";
export const AUTH_BASE_URL_ENV = "AUTH_BASE_URL";
export const LETTERMINT_API_KEY_ENV = "LETTERMINT_API_KEY";
export const EMAIL_FROM_ADDRESS_ENV = "EMAIL_FROM_ADDRESS";
export const AUTH_TRUSTED_PROXY_IP_HEADERS_ENV = "AUTH_TRUSTED_PROXY_IP_HEADERS";
export const PORT_ENV = "PORT";

export type ServerEnvironment = AuthSecretEnvironment & Readonly<Record<string, string | undefined>>;

export interface ServerConfig {
  readonly databaseUrl: string;
  readonly authBaseUrl: string;
  readonly keyring: Keyring;
  readonly lettermintApiKey: string;
  readonly emailFromAddress: string;
  readonly trustedProxyIpHeaders: readonly TrustableProxyIpHeader[];
  readonly port: number;
  /** HEN-239: Google is required; Apple stays off until all its variables are set (Henry's Apple developer account). */
  readonly socialProviders: SocialProviderConfig;
}

/** Errors name the variable only; values are never echoed. */
function requireVariable(env: ServerEnvironment, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function parseTrustedProxyIpHeaders(raw: string | undefined): TrustableProxyIpHeader[] {
  if (raw === undefined || raw.trim() === "") {
    return [];
  }
  return raw.split(",").map((entry) => {
    const headerName = entry.trim().toLowerCase();
    if (!(TRUSTABLE_PROXY_IP_HEADERS as readonly string[]).includes(headerName)) {
      throw new Error(`${AUTH_TRUSTED_PROXY_IP_HEADERS_ENV} accepts only: ${TRUSTABLE_PROXY_IP_HEADERS.join(", ")}`);
    }
    return headerName as TrustableProxyIpHeader;
  });
}

/**
 * Reads and validates everything the server needs at startup, so a misconfigured deploy fails before
 * listening. Both auth secrets are decoded and checked here (length, distinctness).
 */
export function loadServerConfig(env: ServerEnvironment): ServerConfig {
  const keyring = loadAuthKeyringFromEnvironment(env);
  const authBaseUrl = requireVariable(env, AUTH_BASE_URL_ENV);
  if (!URL.canParse(authBaseUrl)) {
    throw new Error(`${AUTH_BASE_URL_ENV} must be an absolute URL`);
  }
  const portValue = env[PORT_ENV]?.trim();
  const port = portValue ? Number(portValue) : 3000;
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`${PORT_ENV} must be an integer between 1 and 65535`);
  }
  const socialProviders = loadSocialProviderConfig(env, { requireGoogle: true });
  return {
    databaseUrl: requireVariable(env, DATABASE_URL_ENV),
    authBaseUrl,
    keyring,
    lettermintApiKey: requireVariable(env, LETTERMINT_API_KEY_ENV),
    emailFromAddress: requireVariable(env, EMAIL_FROM_ADDRESS_ENV),
    trustedProxyIpHeaders: parseTrustedProxyIpHeaders(env[AUTH_TRUSTED_PROXY_IP_HEADERS_ENV]),
    port,
    socialProviders,
  };
}
