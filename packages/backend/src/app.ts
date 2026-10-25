import { Hono, type Context } from "hono";
import type { Kysely } from "kysely";
import { Pool } from "pg";
import { mountAccountRoutes } from "./accountRoutes.js";
import { createAuth, mountAuthRoutes, readSocketAddress, type AuthInstance, type CreateAuthOptions } from "./auth/createAuth.js";
import { createDatabase } from "./database/connection.js";
import type { BjjRollDatabase } from "./database/schema.js";
import { LettermintEmailSender } from "./email/index.js";
import { mountHandleRoutes } from "./handleRoutes.js";
import { loadServerConfig, type ServerConfig, type ServerEnvironment } from "./serverConfig.js";

export interface CreateAppOptions {
  readonly auth?:
    | Pick<
        AuthInstance,
        "handler" | "resolveSessionUserId" | "codec" | "accountDeletionCodes" | "accountDeletionAttempts" | "resolveClientIp" | "emailSender"
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
        emailSender: authInstance.emailSender,
      });
    }
  }

  return honoApp;
}

export interface ServerApp {
  readonly app: Hono;
  readonly config: ServerConfig;
  readonly pool: Pool;
}

/** The production app: validates config (fails fast, never prints values), then mounts /health, /api/auth/*, handle routes and account routes. */
export function createAppFromEnvironment(env: ServerEnvironment = process.env): ServerApp {
  const config = loadServerConfig(env);
  const pool = new Pool({ connectionString: config.databaseUrl });
  const app = createApp({
    auth: {
      pool,
      keyring: config.keyring,
      baseURL: config.authBaseUrl,
      trustedProxyIpHeaders: config.trustedProxyIpHeaders,
      emailSender: new LettermintEmailSender({ apiKey: config.lettermintApiKey, fromAddress: config.emailFromAddress }),
    },
    database: createDatabase(pool),
  });
  return { app, config, pool };
}
