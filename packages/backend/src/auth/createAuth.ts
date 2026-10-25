import { randomUUID } from "node:crypto";
import { expo } from "@better-auth/expo";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Keyring } from "@bjj-roll/shared/encryption";
import { betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { emailOTP, magicLink } from "better-auth/plugins";
import type { BetterAuthOptions } from "better-auth/types";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Pool } from "pg";
import { betterAuthTelemetryDisabledConfig } from "../database/index.js";
import type { EmailSender } from "../email/index.js";
import { ageGateRefusalForNewUser } from "./ageGate.js";
import { createEncryptedRlsAuthAdapter } from "./authAdapter.js";
import { createMagicLinkExchangePlugin } from "./authExchangePlugin.js";
import {
  DEEP_LINK_SCHEME,
  MAGIC_LINK_EXPIRY_MINUTES,
  MAGIC_LINK_EXPIRY_SECONDS,
  MAX_VERIFIES_PER_IP_PER_WINDOW,
  OTP_EXPIRY_MINUTES,
  OTP_EXPIRY_SECONDS,
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  RATE_LIMIT_WINDOW_SECONDS,
  SESSION_SLIDING_EXPIRY_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
} from "./authLimits.js";
import { authIpRateLimitCustomRules, enforcePerEmailSendRateLimit } from "./authRateLimits.js";
import {
  createAuthCryptoCodec,
  generateCsprngOtpCode,
  loadAuthKeyringFromEnvironment,
  type AuthCryptoCodec,
  type AuthSecretEnvironment,
} from "./authSecrets.js";
import {
  assertMagicLinkRedirectParameters,
  AUTH_BASE_PATH,
  CLIENT_IP_HEADER,
  normalizeMagicLinkVerifyResponse,
  prepareMagicLinkRequest,
  resolveClientIpAddress,
  TRUSTABLE_PROXY_IP_HEADERS,
  type TrustableProxyIpHeader,
} from "./authRequestGuards.js";

export { resolveClientIpAddress, TRUSTABLE_PROXY_IP_HEADERS, type TrustableProxyIpHeader } from "./authRequestGuards.js";

export interface CreateAuthOptions {
  readonly pool: Pool;
  readonly emailSender: EmailSender;
  readonly baseURL: string;
  readonly keyring?: Keyring;
  readonly env?: AuthSecretEnvironment;
  readonly trustedOrigins?: readonly string[];
  /** Proxy headers to trust for the client IP. Default: none (the socket address is used). */
  readonly trustedProxyIpHeaders?: readonly TrustableProxyIpHeader[];
  /** Better Auth logger config. Default: disabled. */
  readonly logger?: BetterAuthOptions["logger"];
}

export interface AuthConnectionInfo {
  /** TCP peer address of the request (from the Node socket). */
  readonly remoteAddress?: string | undefined;
}

export interface AuthInstance {
  readonly handler: (request: Request, connection?: AuthConnectionInfo) => Promise<Response>;
  /** User id of the valid session carried by these request headers, or null. */
  readonly resolveSessionUserId: (headers: Headers) => Promise<string | null>;
  readonly codec: AuthCryptoCodec;
  readonly keyring: Keyring;
  readonly telemetry: typeof betterAuthTelemetryDisabledConfig;
}

export function createAuth(options: CreateAuthOptions): AuthInstance {
  const keyring = options.keyring ?? loadAuthKeyringFromEnvironment(options.env);
  const codec = createAuthCryptoCodec(keyring);
  const baseURL = options.baseURL;
  const trustedProxyIpHeaders = options.trustedProxyIpHeaders ?? [];

  const betterAuthInstance = betterAuth({
    baseURL,
    basePath: AUTH_BASE_PATH,
    secret: codec.deriveBetterAuthSecret(),
    telemetry: betterAuthTelemetryDisabledConfig,
    logger: options.logger ?? { disabled: true },
    trustedOrigins: [`${DEEP_LINK_SCHEME}://`, `${DEEP_LINK_SCHEME}://*`, baseURL, ...(options.trustedOrigins ?? [])],
    database: createEncryptedRlsAuthAdapter({ pool: options.pool, codec }),
    user: {
      modelName: "users",
      additionalFields: {
        emailCiphertext: { type: "string", required: false, input: false },
        emailHash: { type: "string", required: false, input: false },
        keyVersion: { type: "number", required: false, input: false },
        handle: { type: "string", required: false, input: false },
      },
    },
    session: {
      modelName: "sessions",
      expiresIn: SESSION_SLIDING_EXPIRY_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
    },
    account: { modelName: "accounts" },
    verification: {
      modelName: "verifications",
      additionalFields: {
        userId: { type: "string", required: false, input: false },
      },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "rate_limits",
      window: RATE_LIMIT_WINDOW_SECONDS,
      max: MAX_VERIFIES_PER_IP_PER_WINDOW,
      customRules: authIpRateLimitCustomRules,
    },
    advanced: {
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
      database: { generateId: () => randomUUID() },
    },
    hooks: {
      before: createAuthMiddleware(async (middlewareContext) => {
        assertMagicLinkRedirectParameters(middlewareContext.path, middlewareContext.body, middlewareContext.query);
        const ageGateRefusal = await ageGateRefusalForNewUser(middlewareContext.path, middlewareContext.body, (email) =>
          middlewareContext.context.internalAdapter.findUserByEmail(email),
        );
        if (ageGateRefusal) {
          return ageGateRefusal;
        }
        if (middlewareContext.path === "/email-otp/send-verification-otp" || middlewareContext.path === "/sign-in/magic-link") {
          const body = middlewareContext.body as Record<string, unknown> | undefined;
          if (typeof body?.email === "string" && body.email.includes("@")) {
            await enforcePerEmailSendRateLimit(options.pool, codec, body.email);
          }
        }
      }),
    },
    plugins: [
      expo(),
      emailOTP({
        otpLength: OTP_LENGTH,
        expiresIn: OTP_EXPIRY_SECONDS,
        allowedAttempts: OTP_MAX_ATTEMPTS,
        generateOTP: () => generateCsprngOtpCode(),
        storeOTP: { hash: (otp) => Promise.resolve(codec.hashOtpCode(otp)) },
        sendVerificationOTP: ({ email, otp }) => options.emailSender.sendOneTimeCode({ to: email, code: otp, expiresInMinutes: OTP_EXPIRY_MINUTES }),
      }),
      magicLink({
        expiresIn: MAGIC_LINK_EXPIRY_SECONDS,
        storeToken: { type: "custom-hasher", hash: (token) => Promise.resolve(codec.hashMagicLinkToken(token)) },
        sendMagicLink: ({ email, url }) => options.emailSender.sendMagicLink({ to: email, url, expiresInMinutes: MAGIC_LINK_EXPIRY_MINUTES }),
      }),
      createMagicLinkExchangePlugin({ pool: options.pool, codec }),
    ],
  });

  return {
    codec,
    keyring,
    telemetry: betterAuthTelemetryDisabledConfig,
    async handler(rawRequest: Request, connection?: AuthConnectionInfo): Promise<Response> {
      const headers = new Headers(rawRequest.headers);
      const clientIp = resolveClientIpAddress(headers, connection?.remoteAddress, trustedProxyIpHeaders);
      for (const headerName of [...TRUSTABLE_PROXY_IP_HEADERS, CLIENT_IP_HEADER]) {
        headers.delete(headerName);
      }
      headers.set(CLIENT_IP_HEADER, clientIp);
      const prepared = await prepareMagicLinkRequest(new Request(rawRequest, { headers }));
      if (prepared instanceof Response) {
        return prepared;
      }
      const response = await betterAuthInstance.handler(prepared);
      return normalizeMagicLinkVerifyResponse(prepared, response);
    },
    async resolveSessionUserId(requestHeaders: Headers): Promise<string | null> {
      try {
        const session = await betterAuthInstance.api.getSession({ headers: requestHeaders });
        return session?.user.id ?? null;
      } catch {
        return null;
      }
    },
  };
}

function readSocketAddress(context: Context): string | undefined {
  try {
    return getConnInfo(context).remote.address;
  } catch {
    return undefined;
  }
}

// 32 KiB covers an email, a one-time code, and a short deep link, and still rejects oversized auth bodies.
export const AUTH_REQUEST_BODY_LIMIT_BYTES = 32 * 1024;

export function mountAuthRoutes(app: Hono, auth: Pick<AuthInstance, "handler">): void {
  app.use(
    `${AUTH_BASE_PATH}/*`,
    bodyLimit({
      maxSize: AUTH_REQUEST_BODY_LIMIT_BYTES,
      onError: (context) => context.text("Payload Too Large", 413),
    }),
  );
  app.on(["GET", "POST"], `${AUTH_BASE_PATH}/*`, async (context) => {
    return await auth.handler(context.req.raw, { remoteAddress: readSocketAddress(context) });
  });
}
