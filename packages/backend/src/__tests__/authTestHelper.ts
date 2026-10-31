import { SIGN_UP_ATTESTATION_TEXT_VERSION } from "@bjj-roll/shared";
import type { Hono } from "hono";
import type { Pool } from "pg";
import { createApp } from "../app.js";
import { createDatabase } from "../database/connection.js";
import {
  createAuth,
  createAuthCryptoCodec,
  generateTestAuthSecrets,
  loadAuthKeyringFromEnvironment,
  type AuthCryptoCodec,
  type AuthInstance,
  type CreateAuthOptions,
} from "../auth/index.js";
import { FakeEmailSender, type EmailQueueLogLine, PgBossEmailQueue } from "../email/index.js";
import { InlineEmailQueue } from "./inlineEmailQueue.js";
import { createAppRoleLoginPool, startMigratedTestDatabase, type AppRoleLoginPool, type MigratedTestDatabase } from "./databaseTestHarness.js";

export const testBaseUrl = "http://localhost:3000";

export const defaultTestClientIp = "203.0.113.10";

export const currentSignUpAttestation = { signUpAttestationTextVersionId: SIGN_UP_ATTESTATION_TEXT_VERSION.id } as const;

export interface StartedAuthTestEnvironment {
  database: MigratedTestDatabase;
  pool: Pool;
  appLogin: AppRoleLoginPool;
  app: Hono;
  auth: AuthInstance;
  emailSender: FakeEmailSender;
  emailQueueLogLines: EmailQueueLogLine[];
  codec: AuthCryptoCodec;
  stop: () => Promise<void>;
}

export async function startAuthTestEnvironment(
  overrides?: Partial<Pick<CreateAuthOptions, "trustedProxyIpHeaders" | "logger" | "socialProviders" | "logAuthEvent">> & {
    emailSender?: FakeEmailSender;
    emailQueue?: "inline" | "pg-boss";
    emailQueueWorker?: boolean;
  },
): Promise<StartedAuthTestEnvironment> {
  const database = await startMigratedTestDatabase();
  const appLogin = await createAppRoleLoginPool(database);
  const secrets = generateTestAuthSecrets();
  const keyring = loadAuthKeyringFromEnvironment(secrets);
  const codec = createAuthCryptoCodec(keyring);
  const { emailSender = new FakeEmailSender(), emailQueue: queueKind = "inline", emailQueueWorker = true, ...authOverrides } = overrides ?? {};
  const emailQueueLogLines: EmailQueueLogLine[] = [];
  const pgBossQueue =
    queueKind === "pg-boss"
      ? new PgBossEmailQueue({
          connectionString: database.connectionString,
          emailSender,
          keyring,
          pollingIntervalSeconds: 0.5,
          logEvent: (line) => emailQueueLogLines.push(line),
        })
      : undefined;
  await pgBossQueue?.start({ worker: emailQueueWorker });
  const auth = createAuth({
    pool: appLogin.pool,
    emailSender,
    emailQueue: pgBossQueue ?? new InlineEmailQueue(emailSender),
    keyring,
    baseURL: testBaseUrl,
    ...authOverrides,
  });
  const app = createApp({ auth, database: createDatabase(appLogin.pool) });

  return {
    database,
    pool: database.pool,
    appLogin,
    app,
    auth,
    emailSender,
    emailQueueLogLines,
    codec,
    stop: async () => {
      await pgBossQueue?.stop();
      await appLogin.stop();
      await database.stop();
    },
  };
}

export function socketEnvironment(ipAddress: string): { incoming: { socket: { remoteAddress: string } } } {
  return { incoming: { socket: { remoteAddress: ipAddress } } };
}

export interface AuthRequestOptions {
  ipAddress?: string;
  cookie?: string;
  headers?: Record<string, string>;
}

export function postAuthJson(app: Hono, path: string, options: AuthRequestOptions & { body: Record<string, unknown> }): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json", ...options.headers };
  if (options.cookie) {
    headers.cookie = options.cookie;
  }
  return Promise.resolve(
    app.request(
      `${testBaseUrl}/api/auth${path}`,
      { method: "POST", headers, body: JSON.stringify(options.body) },
      socketEnvironment(options.ipAddress ?? defaultTestClientIp),
    ),
  );
}

export function getAuthPath(app: Hono, urlOrPath: string, options?: AuthRequestOptions): Promise<Response> {
  const fullUrl = urlOrPath.startsWith("http") ? urlOrPath : `${testBaseUrl}/api/auth${urlOrPath}`;
  const headers: Record<string, string> = { ...options?.headers };
  if (options?.cookie) {
    headers.cookie = options.cookie;
  }
  return Promise.resolve(
    app.request(fullUrl, { method: "GET", headers, redirect: "manual" }, socketEnvironment(options?.ipAddress ?? defaultTestClientIp)),
  );
}

export function extractSessionCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = /([^;,\s]+=[^;]+)/.exec(setCookie);
  return match?.[1] ?? "";
}

export async function dumpRawAuthTables(pool: Pool): Promise<string> {
  const tables = ["users", "sessions", "accounts", "verifications", "rate_limits", "consent_records"];
  const parts: string[] = [];
  for (const table of tables) {
    const existsResult = await pool.query<{ exists: boolean }>("SELECT to_regclass($1) IS NOT NULL AS exists", [`public.${table}`]);
    if (existsResult.rows[0]?.exists) {
      const rowsResult = await pool.query(`SELECT * FROM public.${table}`);
      parts.push(JSON.stringify(rowsResult.rows));
    }
  }
  return parts.join("\n");
}
