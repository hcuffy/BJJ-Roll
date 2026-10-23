DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['bjj_owner', 'bjj_app', 'bjj_job_runner', 'bjj_auth_lookup'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
      BEGIN
        EXECUTE format(
          'CREATE ROLE %I NOLOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE',
          role_name
        );
      EXCEPTION WHEN duplicate_object OR unique_violation THEN
        NULL;
      END;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_roles
      WHERE rolname = role_name
        AND (rolcanlogin OR rolbypassrls OR rolsuper OR rolcreatedb OR rolcreaterole)
    ) THEN
      EXECUTE format(
        'ALTER ROLE %I NOLOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE',
        role_name
      );
    END IF;
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION public.app_current_user_id()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT NULLIF(pg_catalog.current_setting('app.user_id', true), '');
$$;

ALTER FUNCTION public.app_current_user_id() OWNER TO bjj_owner;
REVOKE ALL ON FUNCTION public.app_current_user_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_current_user_id() TO bjj_app, bjj_owner, bjj_auth_lookup;

CREATE TABLE public.users (
  id text PRIMARY KEY,
  email_ciphertext text NOT NULL,
  email_hash text NOT NULL UNIQUE CONSTRAINT users_email_hash_sha256_hex_check CHECK (email_hash ~ '^[0-9a-f]{64}$'),
  key_version integer NOT NULL CHECK (key_version >= 1),
  email_verified boolean NOT NULL DEFAULT false,
  handle text CONSTRAINT users_handle_lowercase_check CHECK (
    handle IS NULL OR (handle = lower(handle) AND length(btrim(handle)) > 0)
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_handle_unique_idx ON public.users (handle) WHERE handle IS NOT NULL;

CREATE TABLE public.sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sessions_user_id_idx ON public.sessions (user_id);

CREATE TABLE public.accounts (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  account_id text NOT NULL,
  provider_id text NOT NULL,
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

CREATE INDEX accounts_user_id_idx ON public.accounts (user_id);

CREATE TABLE public.verifications (
  id text PRIMARY KEY,
  user_id text REFERENCES public.users(id) ON DELETE CASCADE,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX verifications_user_id_idx ON public.verifications (user_id);
CREATE INDEX verifications_identifier_idx ON public.verifications (identifier);

CREATE OR REPLACE FUNCTION public.cascade_delete_user_verifications()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  DELETE FROM public.verifications
  WHERE user_id = OLD.id
     OR identifier IN (
       OLD.email_hash,
       'email-otp-' || OLD.email_hash,
       'sign-in-otp-' || OLD.email_hash,
       'email-verification-otp-' || OLD.email_hash,
       'forget-password-otp-' || OLD.email_hash
     );
  RETURN OLD;
END;
$$;

ALTER FUNCTION public.cascade_delete_user_verifications() OWNER TO bjj_owner;
REVOKE ALL ON FUNCTION public.cascade_delete_user_verifications() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cascade_delete_user_verifications() TO bjj_app, bjj_owner;

CREATE TRIGGER users_delete_verifications_trigger
  BEFORE DELETE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.cascade_delete_user_verifications();

ALTER TABLE public.users OWNER TO bjj_owner;
ALTER TABLE public.sessions OWNER TO bjj_owner;
ALTER TABLE public.accounts OWNER TO bjj_owner;
ALTER TABLE public.verifications OWNER TO bjj_owner;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions FORCE ROW LEVEL SECURITY;

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts FORCE ROW LEVEL SECURITY;

ALTER TABLE public.verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verifications FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.users, public.sessions, public.accounts, public.verifications FROM PUBLIC;
REVOKE ALL ON TABLE public.users, public.sessions, public.accounts, public.verifications FROM bjj_job_runner;
REVOKE ALL ON TABLE public.users, public.sessions, public.accounts, public.verifications FROM bjj_auth_lookup;
REVOKE ALL ON TABLE public.users, public.sessions, public.accounts, public.verifications FROM bjj_app;

GRANT USAGE ON SCHEMA public TO bjj_owner, bjj_app, bjj_job_runner, bjj_auth_lookup;
GRANT SELECT, INSERT, DELETE ON TABLE public.users TO bjj_app;
GRANT UPDATE (email_ciphertext, key_version, email_verified, handle, updated_at) ON TABLE public.users TO bjj_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sessions, public.accounts, public.verifications TO bjj_app;
GRANT SELECT ON TABLE public.users TO bjj_auth_lookup;

CREATE POLICY users_owner_policy ON public.users
  FOR ALL
  TO bjj_app, bjj_owner
  USING (id = public.app_current_user_id())
  WITH CHECK (id = public.app_current_user_id());

CREATE POLICY users_auth_lookup_select ON public.users
  FOR SELECT
  TO bjj_auth_lookup
  USING (true);

CREATE POLICY sessions_owner_policy ON public.sessions
  FOR ALL
  TO bjj_app, bjj_owner
  USING (user_id = public.app_current_user_id())
  WITH CHECK (user_id = public.app_current_user_id());

CREATE POLICY accounts_owner_policy ON public.accounts
  FOR ALL
  TO bjj_app, bjj_owner
  USING (user_id = public.app_current_user_id())
  WITH CHECK (user_id = public.app_current_user_id());

CREATE POLICY verifications_owner_policy ON public.verifications
  FOR ALL
  TO bjj_app, bjj_owner
  USING (
    user_id = public.app_current_user_id()
    OR (
      user_id IS NULL
      AND EXISTS (
        SELECT 1
        FROM public.users AS u
        WHERE u.id = public.app_current_user_id()
          AND public.verifications.identifier IN (
            u.email_hash,
            'email-otp-' || u.email_hash,
            'sign-in-otp-' || u.email_hash,
            'email-verification-otp-' || u.email_hash,
            'forget-password-otp-' || u.email_hash
          )
      )
    )
  )
  WITH CHECK (
    user_id = public.app_current_user_id()
    OR (
      user_id IS NULL
      AND EXISTS (
        SELECT 1
        FROM public.users AS u
        WHERE u.id = public.app_current_user_id()
          AND public.verifications.identifier IN (
            u.email_hash,
            'email-otp-' || u.email_hash,
            'sign-in-otp-' || u.email_hash,
            'email-verification-otp-' || u.email_hash,
            'forget-password-otp-' || u.email_hash
          )
      )
    )
  );

CREATE OR REPLACE FUNCTION public.app_user_id_by_email_hmac(email_hmac text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT u.id FROM public.users AS u WHERE u.email_hash = email_hmac LIMIT 1;
$$;

ALTER FUNCTION public.app_user_id_by_email_hmac(text) OWNER TO bjj_auth_lookup;
REVOKE ALL ON FUNCTION public.app_user_id_by_email_hmac(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_user_id_by_email_hmac(text) FROM bjj_auth_lookup;
GRANT EXECUTE ON FUNCTION public.app_user_id_by_email_hmac(text) TO bjj_app;
