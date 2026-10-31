import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

export const spikeSchemaSql = `
CREATE TABLE users (
  id text PRIMARY KEY,
  name text NOT NULL,
  email_hash text NOT NULL UNIQUE,
  email_ciphertext text NOT NULL,
  email_verified boolean NOT NULL DEFAULT false,
  image text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
  id text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE
);
CREATE TABLE accounts (
  id text PRIMARY KEY,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE verifications (
  id text PRIMARY KEY,
  identifier text NOT NULL UNIQUE,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE rate_limits (
  id text PRIMARY KEY,
  key text NOT NULL UNIQUE,
  count integer NOT NULL,
  last_request bigint NOT NULL
);

-- Sara's call (PLAN.md section 6): a lookup role with no BYPASSRLS owns a SECURITY DEFINER function.
CREATE ROLE bjj_app NOLOGIN NOBYPASSRLS;
CREATE ROLE bjj_auth_lookup NOLOGIN NOBYPASSRLS;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
GRANT SELECT ON users TO bjj_app;
CREATE POLICY users_self_select ON users FOR SELECT TO bjj_app USING (id = current_setting('app.user_id', true));
GRANT USAGE ON SCHEMA public TO bjj_auth_lookup;
GRANT SELECT (id, email_hash) ON users TO bjj_auth_lookup;
CREATE POLICY users_auth_lookup_select ON users FOR SELECT TO bjj_auth_lookup USING (true);
CREATE FUNCTION auth_lookup_user_id(lookup_email_hash text) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$ SELECT id FROM public.users WHERE email_hash = lookup_email_hash $$;
ALTER FUNCTION auth_lookup_user_id(text) OWNER TO bjj_auth_lookup;
REVOKE EXECUTE ON FUNCTION auth_lookup_user_id(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup_user_id(text) TO bjj_app;
`;

export const spikeTables = ["users", "sessions", "accounts", "verifications", "rate_limits"] as const;

export async function lookupUserIdAsAppRole(pool: Pool, emailHash: string): Promise<string | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE bjj_app");
    const result = await client.query<{ user_id: string | null }>("SELECT auth_lookup_user_id($1) AS user_id", [emailHash]);
    await client.query("COMMIT");
    return result.rows[0]?.user_id ?? null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function consumeEmailSendBudget(pool: Pool, emailHash: string, windowMilliseconds: number): Promise<number> {
  const now = Date.now();
  const result = await pool.query<{ count: number }>(
    `INSERT INTO rate_limits (id, key, count, last_request) VALUES ($1, $2, 1, $3)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN $3 - rate_limits.last_request >= $4 THEN 1 ELSE rate_limits.count + 1 END,
       last_request = CASE WHEN $3 - rate_limits.last_request >= $4 THEN $3 ELSE rate_limits.last_request END
     RETURNING count`,
    [randomUUID(), `email-send:${emailHash}`, now, windowMilliseconds],
  );
  return result.rows[0]?.count ?? Number.POSITIVE_INFINITY;
}
