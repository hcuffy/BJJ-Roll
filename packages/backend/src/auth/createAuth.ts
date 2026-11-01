import { randomUUID } from "node:crypto";
import { expo } from "@better-auth/expo";
import type { Keyring } from "@bjj-roll/shared/encryption";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";
import { emailOTP, magicLink } from "better-auth/plugins";
import type { BetterAuthOptions } from "better-auth/types";
import type { Pool } from "pg";
import { betterAuthTelemetryDisabledConfig } from "../database/index.js";
import type { EmailQueue, EmailSender } from "../email/index.js";
import { createAccountDeletionAttempts, type AccountDeletionAttempts } from "./accountDeletionAttempts.js";
import { createAccountDeletionCodes, type AccountDeletionCodes } from "./accountDeletionCodes.js";
import { assertSignUpAgeConfirmation, isAccountCreatingSend, recordPendingAgeAnswers, storeAgeConfirmationInUserTransaction } from "./ageGate.js";
import { createEncryptedRlsAuthAdapter } from "./authAdapter.js";
import { createMagicLinkExchangePlugin } from "./authExchangePlugin.js";
import { isAllowListedAuthPath, withAuthRoutesAllowList } from "./authRoutesAllowList.js";
import { storeMagicLinkVerifier } from "./signInVerifier.js";
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
  trustableProxyIpHeaders,
  type TrustableProxyIpHeader,
} from "./authRequestGuards.js";
import { refuseUnsafeAppleIdToken, refuseUnverifiedProviderEmail } from "./socialSignInSafety.js";
import { buildSocialProviders, type SocialProviderConfig } from "./socialProviders.js";
import {
  afterAuthRequest,
  createAppleSignInCapture,
  revokeSealedAppleRefreshToken,
  socialSignUpAgeAnswers,
  type AuthEventLogger,
} from "./socialSignInHooks.js";

export { trustableProxyIpHeaders, type TrustableProxyIpHeader } from "./authRequestGuards.js";

export interface CreateAuthOptions {
  readonly pool: Pool;
  readonly emailSender: EmailSender;
  readonly emailQueue: EmailQueue;
  readonly baseURL: string;
  readonly keyring?: Keyring;
  readonly env?: AuthSecretEnvironment;
  readonly trustedOrigins?: readonly string[];
  readonly trustedProxyIpHeaders?: readonly TrustableProxyIpHeader[];
  readonly logger?: BetterAuthOptions["logger"];
  readonly socialProviders?: SocialProviderConfig;
  readonly logAuthEvent?: AuthEventLogger;
}

interface AuthConnectionInfo {
  readonly remoteAddress?: string | undefined;
}

export interface AuthInstance {
  readonly handler: (request: Request, connection?: AuthConnectionInfo) => Promise<Response>;
  readonly resolveSessionUserId: (headers: Headers) => Promise<string | null>;
  readonly codec: AuthCryptoCodec;
  readonly keyring: Keyring;
  readonly accountDeletionCodes: AccountDeletionCodes;
  readonly accountDeletionAttempts: AccountDeletionAttempts;
  readonly resolveClientIp: (headers: Headers, connection?: AuthConnectionInfo) => string;
  readonly emailSender: EmailSender;
  readonly emailQueue: EmailQueue;
  readonly telemetry: typeof betterAuthTelemetryDisabledConfig;
  readonly revokeAppleRefreshToken: (sealedRefreshToken: string) => Promise<void>;
}

export function createAuth(options: CreateAuthOptions): AuthInstance {
  const keyring = options.keyring ?? loadAuthKeyringFromEnvironment(options.env);
  const codec = createAuthCryptoCodec(keyring);
  const baseURL = options.baseURL;
  const trustedProxyIpHeaders = options.trustedProxyIpHeaders ?? [];
  const socialProviderConfig = options.socialProviders ?? {};
  const appleSignIn = createAppleSignInCapture(socialProviderConfig.apple, codec, options.logAuthEvent);

  const betterAuthOptions = withAuthRoutesAllowList({
    baseURL,
    basePath: AUTH_BASE_PATH,
    secret: codec.deriveBetterAuthSecret(),
    telemetry: betterAuthTelemetryDisabledConfig,
    logger: options.logger ?? { disabled: true },
    trustedOrigins: [`${DEEP_LINK_SCHEME}://`, `${DEEP_LINK_SCHEME}://*`, baseURL, ...(options.trustedOrigins ?? [])],
    database: createEncryptedRlsAuthAdapter({
      pool: options.pool,
      codec,
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
      validateUserInfo: refuseUnverifiedProviderEmail,
    },
    session: {
      modelName: "sessions",
      expiresIn: SESSION_SLIDING_EXPIRY_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
    },
    account: {
      modelName: "accounts",
      updateAccountOnSignIn: false,
      accountLinking: { enabled: true, trustedProviders: [], allowDifferentEmails: false },
    },
    socialProviders: buildSocialProviders(socialProviderConfig, appleSignIn.appleTokenClient?.clientSecretFor),
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
          before: async (user, hookContext) => {
            await assertSignUpAgeConfirmation(options.pool, codec, { email: user.email, social: await socialSignUpAgeAnswers(hookContext) });
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (middlewareContext) => {
        assertMagicLinkRedirectParameters(middlewareContext.path, middlewareContext.body, middlewareContext.query);
        await refuseUnsafeAppleIdToken(middlewareContext, options.pool);
        if (middlewareContext.path === "/email-otp/send-verification-otp" || middlewareContext.path === "/sign-in/magic-link") {
          const body = middlewareContext.body as Record<string, unknown> | undefined;
          if (middlewareContext.path === "/email-otp/send-verification-otp" && middlewareContext.request && body?.type !== "sign-in") {
            throw new APIError("BAD_REQUEST", { message: "Invalid OTP type" });
          }
          if (typeof body?.email === "string" && body.email.includes("@")) {
            await enforcePerEmailSendRateLimit(options.pool, codec, body.email);
          }
          if (isAccountCreatingSend(middlewareContext.path, body) && middlewareContext.request) {
            await recordPendingAgeAnswers(options.pool, codec, body);
          }
        }
      }),
      after: createAuthMiddleware(async (middlewareContext) => await afterAuthRequest(middlewareContext, appleSignIn, options.pool)),
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
            await options.emailSender.sendOneTimeCode({ ...input, purpose: "account_deletion" });
            return;
          }
          await options.emailQueue.enqueue({ kind: "one_time_code", input });
        },
      }),
      magicLink({
        expiresIn: MAGIC_LINK_EXPIRY_SECONDS,
        storeToken: { type: "custom-hasher", hash: (token) => Promise.resolve(codec.hashMagicLinkToken(token)) },
        sendMagicLink: async ({ email, url, token, metadata }) => {
          await storeMagicLinkVerifier(options.pool, codec, { token, metadata });
          await options.emailQueue.enqueue({ kind: "magic_link", input: { to: email, url, expiresInMinutes: MAGIC_LINK_EXPIRY_MINUTES } });
        },
      }),
      createMagicLinkExchangePlugin({ pool: options.pool, codec }),
    ],
  });
  const betterAuthInstance = betterAuth(betterAuthOptions);

  return {
    codec,
    keyring,
    accountDeletionCodes: createAccountDeletionCodes(betterAuthInstance.api),
    accountDeletionAttempts: createAccountDeletionAttempts(options.pool, codec),
    resolveClientIp: (headers, connection) => resolveClientIpAddress(headers, connection?.remoteAddress, trustedProxyIpHeaders),
    emailSender: options.emailSender,
    emailQueue: options.emailQueue,
    telemetry: betterAuthTelemetryDisabledConfig,
    revokeAppleRefreshToken: async (sealedRefreshToken) => await revokeSealedAppleRefreshToken(appleSignIn, sealedRefreshToken),
    async handler(rawRequest: Request, connection?: AuthConnectionInfo): Promise<Response> {
      if (!isAllowListedAuthPath(new URL(rawRequest.url).pathname)) {
        return new Response("Not Found", { status: 404 });
      }
      const headers = new Headers(rawRequest.headers);
      const clientIp = resolveClientIpAddress(headers, connection?.remoteAddress, trustedProxyIpHeaders);
      for (const headerName of [...trustableProxyIpHeaders, CLIENT_IP_HEADER]) {
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
      } catch (error) {
        if (isAPIError(error) && error.status === "UNAUTHORIZED") {
          return null;
        }
        throw error;
      }
    },
  };
}
