import { Hono, type Context } from "hono";
import type { Kysely } from "kysely";
import { Pool } from "pg";
import { mountAccountRoutes } from "./accountRoutes.js";
import { mountAuthRoutes, readSocketAddress } from "./auth/authRoutes.js";
import { createAuth, type AuthInstance, type CreateAuthOptions } from "./auth/createAuth.js";
import { createDatabase } from "./database/connection.js";
import type { BjjRollDatabase } from "./database/schema.js";
import { LettermintEmailSender, PgBossEmailQueue } from "./email/index.js";
import { mountHandleRoutes } from "./handleRoutes.js";
import { loadServerConfig, type ServerConfig, type ServerEnvironment } from "./serverConfig.js";

export interface CreateAppOptions {
  readonly auth?:
    | Pick<
        AuthInstance,
        | "handler"
        | "resolveSessionUserId"
        | "codec"
        | "accountDeletionCodes"
        | "accountDeletionAttempts"
        | "resolveClientIp"
        | "emailQueue"
        | "revokeAppleRefreshToken"
      >
    | CreateAuthOptions;
  /** When set together with auth, mounts the handle and account routes with the auth session as the user resolver. */
  readonly database?: Kysely<BjjRollDatabase>;
}

export function createApp(options?: CreateAppOptions): Hono {
  const honoApp = new Hono();

  honoApp.get("/health", (context) => context.json({ status: "ok" }));

  if (options?.auth) {
    const authInstance = "handler" in options.auth ? options.auth : createAuth(options.auth);
    mountAuthRoutes(honoApp, authInstance);
    if (options.database) {
      const resolveAuthenticatedUserId = (context: Context) => authInstance.resolveSessionUserId(context.req.raw.headers);
      mountHandleRoutes(honoApp, { db: options.database, resolveAuthenticatedUserId });
      mountAccountRoutes(honoApp, {
        db: options.database,
        resolveAuthenticatedUserId,
        decryptUserEmail: (emailCiphertext, keyVersion) => authInstance.codec.decryptUserEmail(emailCiphertext, keyVersion),
        accountDeletionCodes: authInstance.accountDeletionCodes,
        accountDeletionAttempts: authInstance.accountDeletionAttempts,
        resolveClientIp: (context) => authInstance.resolveClientIp(context.req.raw.headers, { remoteAddress: readSocketAddress(context) }),
        emailQueue: authInstance.emailQueue,
        revokeAppleRefreshToken: (sealedRefreshToken) => authInstance.revokeAppleRefreshToken(sealedRefreshToken),
      });
    }
  }

  return honoApp;
}

export interface ServerApp {
  readonly app: Hono;
  readonly config: ServerConfig;
  readonly pool: Pool;
  /** Not started yet: the server starts it before it listens and stops it on shutdown. */
  readonly emailQueue: PgBossEmailQueue;
}

/** The production app: validates config (fails fast, never prints values), then mounts /health, /api/auth/*, handle routes and account routes. */
export function createAppFromEnvironment(env: ServerEnvironment = process.env): ServerApp {
  const config = loadServerConfig(env);
  const pool = new Pool({ connectionString: config.databaseUrl });
  const emailSender = new LettermintEmailSender({ apiKey: config.lettermintApiKey, fromAddress: config.emailFromAddress });
  const emailQueue = new PgBossEmailQueue({ connectionString: config.databaseUrl, emailSender, keyring: config.keyring });
  const app = createApp({
    auth: {
      pool,
      keyring: config.keyring,
      baseURL: config.authBaseUrl,
      trustedProxyIpHeaders: config.trustedProxyIpHeaders,
      socialProviders: config.socialProviders,
      emailSender,
      emailQueue,
    },
    database: createDatabase(pool),
  });
  return { app, config, pool, emailQueue };
}
