-- HEN-71: Better Auth support objects. Runs once through the Kysely migrator; the app never runs DDL.
-- Every auth query runs as bjj_app (NOLOGIN, NOBYPASSRLS). Rows a request can touch before it knows
-- its user are reached only through exact-match transaction-local settings set by the auth adapter:
--   app.verification_identifier  hashed verification identifier (OTP, magic link, exchange code)
--   app.verification_id          verification row id returned by an earlier scoped read
--   app.session_token_hash       keyed HMAC of the session token (raw tokens are never stored)

CREATE TABLE public.rate_limits (
  id text PRIMARY KEY,
  key text NOT NULL UNIQUE,
  count integer NOT NULL,
  last_request bigint NOT NULL
);

ALTER TABLE public.rate_limits OWNER TO bjj_owner;
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limits FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rate_limits FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.rate_limits TO bjj_app;

-- Rate-limit rows hold only counters keyed by client IP + path or by email HMAC; no user data.
CREATE POLICY rate_limits_app_policy ON public.rate_limits
  FOR ALL
  TO bjj_app, bjj_owner
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.app_current_verification_identifier()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT NULLIF(pg_catalog.current_setting('app.verification_identifier', true), '');
$$;

CREATE OR REPLACE FUNCTION public.app_current_verification_id()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT NULLIF(pg_catalog.current_setting('app.verification_id', true), '');
$$;

CREATE OR REPLACE FUNCTION public.app_current_session_token_hash()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT NULLIF(pg_catalog.current_setting('app.session_token_hash', true), '');
$$;

ALTER FUNCTION public.app_current_verification_identifier() OWNER TO bjj_owner;
ALTER FUNCTION public.app_current_verification_id() OWNER TO bjj_owner;
ALTER FUNCTION public.app_current_session_token_hash() OWNER TO bjj_owner;
REVOKE ALL ON FUNCTION public.app_current_verification_identifier() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_current_verification_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_current_session_token_hash() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_current_verification_identifier() TO bjj_app, bjj_owner;
GRANT EXECUTE ON FUNCTION public.app_current_verification_id() TO bjj_app, bjj_owner;
GRANT EXECUTE ON FUNCTION public.app_current_session_token_hash() TO bjj_app, bjj_owner;

-- Pre-user verification rows (OTP for a new email, magic-link token, exchange code): visible only when the
-- request names the exact hashed identifier or the exact row id. A NULL setting matches nothing.
CREATE POLICY verifications_exact_key_policy ON public.verifications
  FOR ALL
  TO bjj_app, bjj_owner
  USING (
    identifier = public.app_current_verification_identifier()
    OR id = public.app_current_verification_id()
  )
  WITH CHECK (
    identifier = public.app_current_verification_identifier()
    OR id = public.app_current_verification_id()
  );

-- Session lookup by the HMAC of the session token only (the token column stores the HMAC, never the raw token).
-- SELECT only: the adapter reads user_id here, sets app.user_id, and every write then passes sessions_owner_policy.
CREATE POLICY sessions_token_hash_select ON public.sessions
  FOR SELECT
  TO bjj_app, bjj_owner
  USING (token = public.app_current_session_token_hash());
