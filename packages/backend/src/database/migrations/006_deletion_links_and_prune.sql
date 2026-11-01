-- Sign-in rows written before an account exists (magic-link token, its device verifier, pending sign-up answers)
-- carry the email HMAC so deleting the account removes them too.
ALTER TABLE public.verifications ADD COLUMN email_hash text;
CREATE INDEX verifications_email_hash_idx ON public.verifications (email_hash);

CREATE POLICY verifications_owner_email_hash_policy ON public.verifications
  FOR ALL
  TO bjj_app, bjj_owner
  USING (
    user_id IS NULL
    AND email_hash IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.users AS u WHERE u.id = public.app_current_user_id() AND u.email_hash = public.verifications.email_hash)
  )
  WITH CHECK (
    user_id IS NULL
    AND email_hash IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.users AS u WHERE u.id = public.app_current_user_id() AND u.email_hash = public.verifications.email_hash)
  );

CREATE OR REPLACE FUNCTION public.cascade_delete_user_verifications()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  DELETE FROM public.verifications
  WHERE user_id = OLD.id
     OR email_hash = OLD.email_hash
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

-- An hourly job removes expired sign-in rows, expired sessions and rate-limit counters past their window.
-- Only the owner role inside prune_expired_auth_rows() may see other people's expired rows.
CREATE POLICY verifications_expired_owner_prune ON public.verifications
  FOR ALL
  TO bjj_owner
  USING (expires_at < now());

CREATE POLICY sessions_expired_owner_prune ON public.sessions
  FOR ALL
  TO bjj_owner
  USING (expires_at < now());

CREATE OR REPLACE FUNCTION public.prune_expired_auth_rows(rate_limit_cutoff_ms bigint)
RETURNS TABLE (table_name text, deleted_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  deleted bigint;
BEGIN
  DELETE FROM public.verifications WHERE expires_at < now();
  GET DIAGNOSTICS deleted = ROW_COUNT;
  table_name := 'verifications';
  deleted_count := deleted;
  RETURN NEXT;

  DELETE FROM public.sessions WHERE expires_at < now();
  GET DIAGNOSTICS deleted = ROW_COUNT;
  table_name := 'sessions';
  deleted_count := deleted;
  RETURN NEXT;

  DELETE FROM public.rate_limits WHERE last_request < rate_limit_cutoff_ms;
  GET DIAGNOSTICS deleted = ROW_COUNT;
  table_name := 'rate_limits';
  deleted_count := deleted;
  RETURN NEXT;
END;
$$;

ALTER FUNCTION public.prune_expired_auth_rows(bigint) OWNER TO bjj_owner;
REVOKE ALL ON FUNCTION public.prune_expired_auth_rows(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prune_expired_auth_rows(bigint) TO bjj_app;
