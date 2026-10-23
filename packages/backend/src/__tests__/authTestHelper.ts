import type { Hono } from "hono";
import type { Pool } from "pg";
import { createApp } from "../app.js";
import { createAuthCryptoCodec, generateTestAuthSecrets, loadAuthKeyringFromEnvironment, type AuthCryptoCodec } from "../auth/index.js";
import { FakeEmailSender } from "../email/index.js";
import { startMigratedTestDatabase, type MigratedTestDatabase } from "./databaseTestHarness.js";

export const testBaseUrl = "http://localhost:3000";

export interface StartedAuthTestEnvironment {
  database: MigratedTestDatabase;
  pool: Pool;
  app: Hono;
  emailSender: FakeEmailSender;
  codec: AuthCryptoCodec;
  stop: () => Promise<void>;
}

export async function startAuthTestEnvironment(): Promise<StartedAuthTestEnvironment> {
  const database = await startMigratedTestDatabase();
  const secrets = generateTestAuthSecrets();
  const keyring = loadAuthKeyringFromEnvironment(secrets);
  const codec = createAuthCryptoCodec(keyring);
  const emailSender = new FakeEmailSender();
  const app = createApp({
    auth: {
      pool: database.pool,
      emailSender,
      keyring,
      baseURL: testBaseUrl,
    },
  });

  return {
    database,
    pool: database.pool,
    app,
    emailSender,
    codec,
    stop: async () => {
      await database.stop();
    },
  };
}

export function postAuthJson(
  app: Hono,
  path: string,
  options: {
    body: Record<string, unknown>;
    ipAddress?: string;
    cookie?: string;
  },
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": options.ipAddress ?? "203.0.113.10",
  };
  if (options.cookie) {
    headers.cookie = options.cookie;
  }
  return Promise.resolve(
    app.request(`${testBaseUrl}/api/auth${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(options.body),
    }),
  );
}

export function getAuthPath(
  app: Hono,
  urlOrPath: string,
  options?: {
    ipAddress?: string;
    cookie?: string;
  },
): Promise<Response> {
  const fullUrl = urlOrPath.startsWith("http") ? urlOrPath : `${testBaseUrl}/api/auth${urlOrPath}`;
  const headers: Record<string, string> = {
    "x-forwarded-for": options?.ipAddress ?? "203.0.113.10",
  };
  if (options?.cookie) {
    headers.cookie = options.cookie;
  }
  return Promise.resolve(
    app.request(fullUrl, {
      method: "GET",
      headers,
      redirect: "manual",
    }),
  );
}

export function extractSessionCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = /([^;,\s]+=[^;]+)/.exec(setCookie);
  return match?.[1] ?? "";
}

export async function dumpRawAuthTables(pool: Pool): Promise<string> {
  const tables = ["users", "sessions", "accounts", "verifications", "rate_limits"];
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
