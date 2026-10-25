import { Hono } from "hono";
import type { Kysely } from "kysely";
import { Pool } from "pg";
import { createAuth, mountAuthRoutes, type AuthInstance, type CreateAuthOptions } from "./auth/createAuth.js";
import { createDatabase } from "./database/connection.js";
import type { BjjRollDatabase } from "./database/schema.js";
import { LettermintEmailSender } from "./email/index.js";
import { mountHandleRoutes } from "./handleRoutes.js";
import { loadServerConfig, type ServerConfig, type ServerEnvironment } from "./serverConfig.js";

export interface CreateAppOptions {
  readonly auth?: Pick<AuthInstance, "handler" | "resolveSessionUserId"> | CreateAuthOptions;
  /** When set together with auth, mounts the handle routes with the auth session as the user resolver. */
  readonly database?: Kysely<BjjRollDatabase>;
}

export function createApp(options?: CreateAppOptions): Hono {
  const honoApp = new Hono();

  honoApp.get("/health", (context) => context.json({ status: "ok" }));

  if (options?.auth) {
    const authInstance = "handler" in options.auth ? options.auth : createAuth(options.auth);
    mountAuthRoutes(honoApp, authInstance);
    if (options.database) {
      mountHandleRoutes(honoApp, {
        db: options.database,
        resolveAuthenticatedUserId: (context) => authInstance.resolveSessionUserId(context.req.raw.headers),
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

/** The production app: validates config (fails fast, never prints values), then mounts /health, /api/auth/*, and handle routes. */
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
