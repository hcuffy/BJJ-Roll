import { randomUUID } from "node:crypto";
import { expo } from "@better-auth/expo";
import type { Keyring } from "@bjj-roll/shared/encryption";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { emailOTP, magicLink } from "better-auth/plugins";
import type { Hono } from "hono";
import type { Pool } from "pg";
import { betterAuthTelemetryDisabledConfig } from "../database/index.js";
import type { EmailSender } from "../email/index.js";
import { createEncryptedRlsAuthAdapter } from "./authAdapter.js";
import { createMagicLinkExchangePlugin } from "./authExchangePlugin.js";
import {
  DEEP_LINK_CALLBACK_URL,
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
import { authIpRateLimitCustomRules, enforcePerEmailSendRateLimit, ensureAuthRateLimitsTable } from "./authRateLimits.js";
import {
  createAuthCryptoCodec,
  generateCsprngOtpCode,
  loadAuthKeyringFromEnvironment,
  type AuthCryptoCodec,
  type AuthSecretEnvironment,
} from "./authSecrets.js";

const DEFAULT_BASE_URL = "http://localhost:3000";

export interface CreateAuthOptions {
  readonly pool: Pool;
  readonly emailSender: EmailSender;
  readonly keyring?: Keyring;
  readonly env?: AuthSecretEnvironment;
  readonly baseURL?: string;
  readonly trustedOrigins?: readonly string[];
}

export interface AuthInstance {
  readonly handler: (request: Request) => Promise<Response>;
  readonly codec: AuthCryptoCodec;
  readonly keyring: Keyring;
  readonly telemetry: typeof betterAuthTelemetryDisabledConfig;
}

function ensureClientIpHeader(request: Request): Request {
  if (request.headers.has("x-forwarded-for") || request.headers.has("cf-connecting-ip") || request.headers.has("x-real-ip")) {
    return request;
  }
  const headers = new Headers(request.headers);
  headers.set("x-forwarded-for", "127.0.0.1");
  return new Request(request, { headers });
}

function prepareMagicLinkVerifyRequest(request: Request): { request: Request; invalidCallbackResponse: Response | null } {
  const url = new URL(request.url);
  if (!url.pathname.endsWith("/magic-link/verify")) {
    return { request, invalidCallbackResponse: null };
  }
  const rawCallbackUrl = url.searchParams.get("callbackURL");
  if (rawCallbackUrl === null || rawCallbackUrl.trim().length === 0) {
    url.searchParams.set("callbackURL", DEEP_LINK_CALLBACK_URL);
    return { request: new Request(url.toString(), request), invalidCallbackResponse: null };
  }
  if (!rawCallbackUrl.trim().toLowerCase().startsWith(`${DEEP_LINK_SCHEME}://`)) {
    return {
      request,
      invalidCallbackResponse: new Response(
        JSON.stringify({
          code: "INVALID_CALLBACK_URL",
          error: "INVALID_CALLBACK_URL",
          message: "Magic link callbackURL must use the bjjroll:// scheme in M2",
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    };
  }
  return { request, invalidCallbackResponse: null };
}

function normalizeMagicLinkVerifyResponse(request: Request, response: Response): Response {
  const url = new URL(request.url);
  if (!url.pathname.endsWith("/magic-link/verify")) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.delete("set-cookie");
  const location = headers.get("location");
  if (!location) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
  try {
    const redirectUrl = new URL(location);
    redirectUrl.searchParams.delete("cookie");
    redirectUrl.searchParams.delete("token");
    redirectUrl.searchParams.delete("session");
    headers.set("location", redirectUrl.toString());

    const errorCode = redirectUrl.searchParams.get("error");
    if (errorCode !== null) {
      headers.set("content-type", "application/json");
      return new Response(
        JSON.stringify({
          code: errorCode,
          error: errorCode,
          message: "Magic link token is invalid, expired, or has already been used",
        }),
        { status: 400, headers },
      );
    }
  } catch {
    // Keep sanitized headers if location is not a valid URL
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function createAuth(options: CreateAuthOptions): AuthInstance {
  const keyring = options.keyring ?? loadAuthKeyringFromEnvironment(options.env);
  const codec = createAuthCryptoCodec(keyring);
  const baseURL = options.baseURL ?? DEFAULT_BASE_URL;

  const betterAuthInstance = betterAuth({
    baseURL,
    basePath: "/api/auth",
    secret: codec.deriveBetterAuthSecret(),
    telemetry: betterAuthTelemetryDisabledConfig,
    logger: { disabled: true },
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
      ipAddress: { ipAddressHeaders: ["x-forwarded-for", "cf-connecting-ip", "x-real-ip"] },
      database: { generateId: () => randomUUID() },
    },
    hooks: {
      before: createAuthMiddleware(async (middlewareContext) => {
        if (middlewareContext.path === "/email-otp/send-verification-otp" || middlewareContext.path === "/sign-in/magic-link") {
          const body = middlewareContext.body as Record<string, unknown> | undefined;
          if (middlewareContext.path === "/sign-in/magic-link") {
            for (const candidate of [body?.callbackURL, body?.newUserCallbackURL, body?.errorCallbackURL]) {
              if (
                typeof candidate === "string" &&
                candidate.trim().length > 0 &&
                !candidate.trim().toLowerCase().startsWith(`${DEEP_LINK_SCHEME}://`)
              ) {
                throw new APIError("BAD_REQUEST", { message: "Magic link callbackURL must use the bjjroll:// scheme in M2" });
              }
            }
          }
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
    async handler(rawRequest: Request): Promise<Response> {
      await ensureAuthRateLimitsTable(options.pool);
      const requestWithIp = ensureClientIpHeader(rawRequest);
      const prepared = prepareMagicLinkVerifyRequest(requestWithIp);
      if (prepared.invalidCallbackResponse !== null) {
        return prepared.invalidCallbackResponse;
      }
      const response = await betterAuthInstance.handler(prepared.request);
      return normalizeMagicLinkVerifyResponse(prepared.request, response);
    },
  };
}

export function mountAuthRoutes(app: Hono, auth: Pick<AuthInstance, "handler">): void {
  app.on(["GET", "POST"], "/api/auth/*", async (context) => {
    return await auth.handler(context.req.raw);
  });
}
