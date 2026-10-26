-- HEN-263: the user's age answers, stored as consent records (ARCHITECTURE.md §2.4). Two booleans, the text version the
-- user saw and when; never a birthdate. Records are append-only for the app: a later 18+ confirmation is a new row, and
-- the only way to remove a record is deleting the account (ON DELETE CASCADE), so bjj_app gets no UPDATE or DELETE.
-- HEN-183 adds its consent types to the CHECK below when it ships.

CREATE TABLE public.consent_records (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  consent_type text NOT NULL CHECK (consent_type IN ('age_confirmation')),
  text_version_id text NOT NULL CHECK (text_version_id <> ''),
  age16_confirmed boolean,
  age18_confirmed boolean,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz,
  CONSTRAINT consent_records_age_confirmation_answers CHECK (
    consent_type <> 'age_confirmation' OR (age16_confirmed IS TRUE AND age18_confirmed IS NOT NULL)
  )
);

CREATE INDEX consent_records_user_id_idx ON public.consent_records (user_id, accepted_at);

ALTER TABLE public.consent_records OWNER TO bjj_owner;
ALTER TABLE public.consent_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consent_records FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.consent_records FROM PUBLIC;
REVOKE ALL ON TABLE public.consent_records FROM bjj_job_runner;
REVOKE ALL ON TABLE public.consent_records FROM bjj_auth_lookup;
REVOKE ALL ON TABLE public.consent_records FROM bjj_app;
GRANT SELECT, INSERT ON TABLE public.consent_records TO bjj_app;

CREATE POLICY consent_records_owner_policy ON public.consent_records
  FOR ALL
  TO bjj_app, bjj_owner
  USING (user_id = public.app_current_user_id())
  WITH CHECK (user_id = public.app_current_user_id());
