import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Kysely } from "kysely";
import { Pool } from "pg";
import { mountAccountRoutes } from "./accountRoutes.js";
import { mountAuthRoutes, readSocketAddress } from "./auth/authRoutes.js";
import { createAuth, type AuthInstance, type CreateAuthOptions } from "./auth/createAuth.js";
import { createDatabase } from "./database/connection.js";
import type { BjjRollDatabase } from "./database/schema.js";
import { readSchemaVersion } from "./database/schemaVersion.js";
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
  readonly database?: Kysely<BjjRollDatabase>;
}

export function createApp(options?: CreateAppOptions): Hono {
  const honoApp = new Hono();

  honoApp.get("/health", (context) => context.json({ status: "ok" }));

  if (options?.auth) {
    const authInstance = "handler" in options.auth ? options.auth : createAuth(options.auth);
    mountAuthRoutes(honoApp, authInstance);
    if (options.database) {
      const resolveAuthenticatedUserId = async (context: Context) => {
        try {
          return await authInstance.resolveSessionUserId(context.req.raw.headers);
        } catch {
          throw new HTTPException(503, { res: Response.json({ error: "unavailable" }, { status: 503 }) });
        }
      };
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
  readonly emailQueue: PgBossEmailQueue;
}

const safeErrorCodePattern = /^[A-Z0-9_]{1,32}$/u;

function safeErrorCode(error: unknown): string {
  const code: unknown = error instanceof Object && "code" in error ? error.code : undefined;
  return typeof code === "string" && safeErrorCodePattern.test(code) ? code : "unknown";
}

export async function createAppFromEnvironment(env: ServerEnvironment = process.env): Promise<ServerApp> {
  const config = loadServerConfig(env);
  const pool = new Pool({ connectionString: config.databaseUrl });
  const database = createDatabase(pool);
  const schemaVersion = await readSchemaVersion(database).catch(async (error: unknown) => {
    console.error(JSON.stringify({ event: "db_unreachable", code: safeErrorCode(error) }));
    await pool.end();
    return process.exit(1);
  });
  if (schemaVersion.latestApplied !== schemaVersion.newestBundled) {
    console.error(JSON.stringify({ event: "schema_out_of_date", ...schemaVersion }));
    await pool.end();
    process.exit(1);
  }
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
    database,
  });
  return { app, config, pool, emailQueue };
}
