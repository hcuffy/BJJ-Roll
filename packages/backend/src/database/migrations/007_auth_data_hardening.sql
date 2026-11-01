DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'bjj_identity_lookup') THEN
    BEGIN
      CREATE ROLE bjj_identity_lookup NOLOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
    EXCEPTION WHEN duplicate_object OR unique_violation THEN
      NULL;
    END;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'bjj_identity_lookup'
      AND (rolcanlogin OR rolbypassrls OR rolsuper OR rolcreatedb OR rolcreaterole)
  ) THEN
    ALTER ROLE bjj_identity_lookup NOLOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO bjj_identity_lookup;
GRANT SELECT (id, email_hash) ON TABLE public.users TO bjj_identity_lookup;
GRANT SELECT (user_id, provider_id, account_id) ON TABLE public.accounts TO bjj_identity_lookup;

CREATE POLICY users_identity_lookup_select ON public.users
  FOR SELECT
  TO bjj_identity_lookup
  USING (true);

CREATE POLICY accounts_identity_lookup_select ON public.accounts
  FOR SELECT
  TO bjj_identity_lookup
  USING (true);

ALTER FUNCTION public.app_user_id_by_email_hmac(text) OWNER TO bjj_identity_lookup;
REVOKE ALL ON FUNCTION public.app_user_id_by_email_hmac(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_user_id_by_email_hmac(text) FROM bjj_identity_lookup;
GRANT EXECUTE ON FUNCTION public.app_user_id_by_email_hmac(text) TO bjj_app;

CREATE OR REPLACE FUNCTION public.app_user_id_by_provider_account(provider text, account text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT a.user_id FROM public.accounts AS a WHERE a.provider_id = provider AND a.account_id = account LIMIT 1;
$$;

ALTER FUNCTION public.app_user_id_by_provider_account(text, text) OWNER TO bjj_identity_lookup;
REVOKE ALL ON FUNCTION public.app_user_id_by_provider_account(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_user_id_by_provider_account(text, text) FROM bjj_identity_lookup;
GRANT EXECUTE ON FUNCTION public.app_user_id_by_provider_account(text, text) TO bjj_app;

REVOKE SELECT ON TABLE public.users FROM bjj_auth_lookup;
GRANT SELECT (id, handle) ON TABLE public.users TO bjj_auth_lookup;

CREATE OR REPLACE FUNCTION public.handle_available(candidate text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.users AS u WHERE u.handle = candidate);
$$;

ALTER FUNCTION public.handle_available(text) OWNER TO bjj_auth_lookup;
REVOKE ALL ON FUNCTION public.handle_available(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_available(text) FROM bjj_auth_lookup;
GRANT EXECUTE ON FUNCTION public.handle_available(text) TO bjj_app;

ALTER TABLE public.users ADD CONSTRAINT users_handle_format_check CHECK (handle IS NULL OR handle ~ '^[a-z0-9_]{3,30}$');

ALTER TABLE public.verifications DISABLE ROW LEVEL SECURITY;
DELETE FROM public.verifications AS older
WHERE starts_with(older.identifier, 'age-confirmation-')
  AND EXISTS (
    SELECT 1
    FROM public.verifications AS newer
    WHERE newer.identifier = older.identifier
      AND (newer.updated_at, newer.id) > (older.updated_at, older.id)
  );
ALTER TABLE public.verifications ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX verifications_age_confirmation_identifier_idx
  ON public.verifications (identifier)
  WHERE starts_with(identifier, 'age-confirmation-');

ALTER TABLE public.sessions DISABLE ROW LEVEL SECURITY;
UPDATE public.sessions SET ip_address = NULL WHERE ip_address IS NOT NULL;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
