-- HEN-239: used Apple id-token nonces are stored as verifications rows ('apple-id-token-nonce:<claim>').
-- Recording a nonce also deletes expired nonce rows in the same transaction, so no cleanup job is needed.

CREATE INDEX verifications_expires_at_idx ON public.verifications (expires_at);

-- bjj_app may see and delete expired used-nonce rows only. Unexpired nonce rows stay behind the exact-key policy,
-- and other verification rows (email codes, magic links, exchange codes) are not reachable this way.
CREATE POLICY verifications_expired_apple_nonce_select ON public.verifications
  FOR SELECT
  TO bjj_app
  USING (starts_with(identifier, 'apple-id-token-nonce:') AND expires_at < now());

CREATE POLICY verifications_expired_apple_nonce_delete ON public.verifications
  FOR DELETE
  TO bjj_app
  USING (starts_with(identifier, 'apple-id-token-nonce:') AND expires_at < now());
