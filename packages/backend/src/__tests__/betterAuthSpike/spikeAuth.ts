import { randomBytes } from "node:crypto";
import { expo } from "@better-auth/expo";
import { kyselyAdapter } from "@better-auth/kysely-adapter";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { emailOTP, magicLink } from "better-auth/plugins";
import { Hono } from "hono";
import { CamelCasePlugin, Kysely, PostgresDialect } from "kysely";
import type { Pool } from "pg";
import { createEmailProtection, type EmailProtection } from "./emailProtection.js";
import { protectAdapter } from "./protectedAdapter.js";
import { consumeEmailSendBudget, lookupUserIdAsAppRole } from "./spikeSchema.js";

// HEN-47 spike only. Sara's PLAN.md section 6 numbers, expressed as Better Auth 1.7.7 options.
const fifteenMinutesInSeconds = 15 * 60;
const oneDayInSeconds = 24 * 60 * 60;
export const otpExpirySeconds = 10 * 60;
export const magicLinkExpirySeconds = 15 * 60;
export const sessionExpirySeconds = 30 * oneDayInSeconds;
export const allowedOtpAttempts = 5;
export const sendsPerEmailPerWindow = 3;
export const sendsPerIpPerWindow = 10;
export const verifiesPerIpPerWindow = 20;
export const spikeBaseUrl = "http://localhost:3000";

export interface SentMessage {
  kind: "otp" | "magic-link";
  email: string;
  secret: string;
}

export interface SpikeAuth {
  app: Hono;
  protection: EmailProtection;
  sentMessages: SentMessage[];
  lookupCalls: string[];
}

const sendLimitedPaths = new Set(["/email-otp/send-verification-otp", "/sign-in/magic-link"]);

export function createSpikeAuth(pool: Pool): SpikeAuth {
  const protection = createEmailProtection();
  const sentMessages: SentMessage[] = [];
  const lookupCalls: string[] = [];
  const kysely = new Kysely({ dialect: new PostgresDialect({ pool }), plugins: [new CamelCasePlugin()] });
  const baseAdapter = kyselyAdapter(kysely, { type: "postgres" });
  const hashSecret = (value: string) => Promise.resolve(protection.hashSecret(value));
  const ipRule = { window: fifteenMinutesInSeconds, max: sendsPerIpPerWindow };
  const verifyRule = { window: fifteenMinutesInSeconds, max: verifiesPerIpPerWindow };

  const auth = betterAuth({
    baseURL: spikeBaseUrl,
    secret: randomBytes(32).toString("hex"),
    trustedOrigins: ["bjjroll://"],
    telemetry: { enabled: false },
    database: (options: BetterAuthOptions) =>
      protectAdapter(baseAdapter(options), {
        protection,
        lookupUserIdByEmailHash: (emailHash: string) => {
          lookupCalls.push(emailHash);
          return lookupUserIdAsAppRole(pool, emailHash);
        },
      }),
    user: {
      modelName: "users",
      fields: { email: "emailHash" },
      additionalFields: { emailCiphertext: { type: "string", required: false, input: false, returned: false } },
    },
    session: { modelName: "sessions", expiresIn: sessionExpirySeconds, updateAge: oneDayInSeconds },
    account: { modelName: "accounts" },
    verification: { modelName: "verifications", storeIdentifier: { hash: hashSecret } },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "rateLimits",
      window: fifteenMinutesInSeconds,
      max: verifiesPerIpPerWindow,
      customRules: {
        "/email-otp/send-verification-otp": ipRule,
        "/sign-in/magic-link": ipRule,
        "/sign-in/email-otp": verifyRule,
        "/magic-link/verify": verifyRule,
      },
    },
    advanced: { ipAddress: { ipAddressHeaders: ["x-forwarded-for"] } },
    hooks: {
      before: createAuthMiddleware(async (context) => {
        const email: unknown = (context.body as { email?: unknown } | undefined)?.email;
        if (!sendLimitedPaths.has(context.path) || typeof email !== "string") {
          return;
        }
        const sends = await consumeEmailSendBudget(pool, protection.hashEmail(email), fifteenMinutesInSeconds * 1000);
        if (sends > sendsPerEmailPerWindow) {
          throw new APIError("TOO_MANY_REQUESTS", { message: "Too many sign-in emails for this address. Try again later." });
        }
      }),
    },
    plugins: [
      expo(),
      emailOTP({
        otpLength: 6,
        expiresIn: otpExpirySeconds,
        allowedAttempts: allowedOtpAttempts,
        storeOTP: { hash: hashSecret },
        sendVerificationOTP: ({ email, otp }) => {
          sentMessages.push({ kind: "otp", email, secret: otp });
          return Promise.resolve();
        },
      }),
      magicLink({
        expiresIn: magicLinkExpirySeconds,
        storeToken: { type: "custom-hasher", hash: hashSecret },
        rateLimit: ipRule,
        sendMagicLink: ({ email, url }) => {
          sentMessages.push({ kind: "magic-link", email, secret: url });
          return Promise.resolve();
        },
      }),
    ],
  });

  const app = new Hono();
  app.on(["GET", "POST"], "/api/auth/*", (context) => auth.handler(context.req.raw));
  return { app, protection, sentMessages, lookupCalls };
}
