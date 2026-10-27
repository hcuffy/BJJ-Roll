import { randomUUID } from "node:crypto";
import { expo } from "@better-auth/expo";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Keyring } from "@bjj-roll/shared/encryption";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { emailOTP, magicLink } from "better-auth/plugins";
import type { BetterAuthOptions } from "better-auth/types";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Pool } from "pg";
import { betterAuthTelemetryDisabledConfig } from "../database/index.js";
import type { EmailSender } from "../email/index.js";
import { createAccountDeletionAttempts, type AccountDeletionAttempts } from "./accountDeletionAttempts.js";
import { createAccountDeletionCodes, type AccountDeletionCodes } from "./accountDeletionCodes.js";
import { assertPendingAgeConfirmation, isAccountCreatingSend, recordPendingAgeAnswers, storeAgeConfirmationInUserTransaction } from "./ageGate.js";
import { createEncryptedRlsAuthAdapter } from "./authAdapter.js";
import { enqueueSignInEmail } from "./signInEmailQueue.js";
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
  /** Fresh email codes for DELETE /account (HEN-65). */
  readonly accountDeletionCodes: AccountDeletionCodes;
  /** Atomic per-user and per-IP try budget for DELETE /account (HEN-65). */
  readonly accountDeletionAttempts: AccountDeletionAttempts;
  /** Client IP for rate limiting, resolved the same way as for /api/auth/*. */
  readonly resolveClientIp: (headers: Headers, connection?: AuthConnectionInfo) => string;
  readonly emailSender: EmailSender;
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
    database: createEncryptedRlsAuthAdapter({
      pool: options.pool,
      codec,
      // HEN-263: the consent record is written in the user insert's own transaction, so neither row can exist without the other.
      onUserCreated: (transaction, user) => storeAgeConfirmationInUserTransaction(transaction, codec, user),
    }),
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
    databaseHooks: {
      user: {
        create: {
          // HEN-263: account creation (OTP code used, magic link opened) needs the 16+ tick from this email's latest send.
          before: async (user) => {
            await assertPendingAgeConfirmation(options.pool, codec, user.email);
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (middlewareContext) => {
        assertMagicLinkRedirectParameters(middlewareContext.path, middlewareContext.body, middlewareContext.query);
        // Over HTTP, check-verification-otp may only test sign-in codes: a public check of a delete code would be a guessing oracle
        // outside the DELETE /account try budget.
        if (middlewareContext.path === "/email-otp/check-verification-otp" && middlewareContext.request) {
          const body = middlewareContext.body as Record<string, unknown> | undefined;
          if (body?.type !== "sign-in") {
            throw new APIError("BAD_REQUEST", { message: "Invalid OTP type" });
          }
        }
        if (middlewareContext.path === "/email-otp/send-verification-otp" || middlewareContext.path === "/sign-in/magic-link") {
          const body = middlewareContext.body as Record<string, unknown> | undefined;
          // Over HTTP only sign-in codes can be asked for; account-deletion codes come from POST /account/delete-code (server call, no request).
          if (middlewareContext.path === "/email-otp/send-verification-otp" && middlewareContext.request && body?.type !== "sign-in") {
            throw new APIError("BAD_REQUEST", { message: "Invalid OTP type" });
          }
          if (typeof body?.email === "string" && body.email.includes("@")) {
            await enforcePerEmailSendRateLimit(options.pool, codec, body.email);
          }
          // HEN-263: no refusal here. Every email gets the same answer; the 16+ check runs when the account is created.
          if (isAccountCreatingSend(middlewareContext.path, body) && middlewareContext.request) {
            await recordPendingAgeAnswers(options.pool, codec, body);
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
        sendVerificationOTP: async ({ email, otp, type }) => {
          const input = { to: email, code: otp, expiresInMinutes: OTP_EXPIRY_MINUTES };
          if (type === "email-verification") {
            // Account-deletion codes come from POST /account/delete-code, a signed-in server call: it still waits for the send.
            await options.emailSender.sendOneTimeCode({ ...input, purpose: "account_deletion" });
            return;
          }
          enqueueSignInEmail(() => options.emailSender.sendOneTimeCode(input));
        },
      }),
      magicLink({
        expiresIn: MAGIC_LINK_EXPIRY_SECONDS,
        storeToken: { type: "custom-hasher", hash: (token) => Promise.resolve(codec.hashMagicLinkToken(token)) },
        sendMagicLink: ({ email, url }) => {
          enqueueSignInEmail(() => options.emailSender.sendMagicLink({ to: email, url, expiresInMinutes: MAGIC_LINK_EXPIRY_MINUTES }));
        },
      }),
      createMagicLinkExchangePlugin({ pool: options.pool, codec }),
    ],
  });

  return {
    codec,
    keyring,
    accountDeletionCodes: createAccountDeletionCodes(betterAuthInstance.api),
    accountDeletionAttempts: createAccountDeletionAttempts(options.pool),
    resolveClientIp: (headers, connection) => resolveClientIpAddress(headers, connection?.remoteAddress, trustedProxyIpHeaders),
    emailSender: options.emailSender,
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

export function readSocketAddress(context: Context): string | undefined {
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
