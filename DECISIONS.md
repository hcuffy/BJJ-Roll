# Decisions

Architecture and tooling decisions for BJJ-Roll. Each entry records the decision, the rejected alternative (where there is one), the date, who decided, and the consequences.

Version bumps (Postgres image, Python) are recorded here and in the PR that makes them.

## A1: Job queue is pg-boss

- **Decision:** Use pg-boss for the job queue.
- **Rejected alternative:** A hand-written `SKIP LOCKED` job table.
- **Date:** 2026-10-17
- **Decided by:** Henry
- **Consequences:** The Hono ↔ Python worker job contract (HEN-41) builds on pg-boss. Known risk: Python workers claiming pg-boss jobs over SQL is untested; HEN-41 and the queue work verify it.

## A2: Postgres test container is Testcontainers

- **Decision:** Use Testcontainers (`@testcontainers/postgresql`) for Postgres in tests. The image is pinned exactly to `postgres:18.6`.
- **Date:** 2026-10-17
- **Decided by:** Henry
- **Consequences:** Used by HEN-55 (Vitest per package + Postgres test container).

## A3: Python lint and test for `packages/workers` is Ruff + pytest

- **Decision:** Use Ruff for lint and pytest for tests in `packages/workers`.
- **Python:** Pinned exactly to `3.15.0` (`.python-version`). Dependencies are managed with uv, with a committed `uv.lock`.
- **Style:** Python uses 4-space indent (PEP 8, Ruff default). The 2-space rule applies to JS/TS only.
- **Test files:** Named `test_<module>_<scenario>.py`.
- **Date:** 2026-10-17
- **Decided by:** Henry
- **Consequences:** Used by HEN-56 (Python worker lint and test).

## A4: Auth DB layer and migrations are Kysely, and our migrations own Better Auth's tables [Accepted]

- **Status:** Accepted
- **Decision:** Kysely is the DB access layer for every table (`@better-auth/kysely-adapter` for Better Auth). Kysely's `Migrator` runs plain SQL migrations. Our migrations own Better Auth's tables. Better Auth's CLI `generate` may be used as a reference only, and `migrate` is never run.
- **Rejected alternatives:** Drizzle ORM + drizzle-kit, node-pg-migrate, dbmate, raw `pg`.
- **Date:** 2026-10-22
- **Decided by:** Sara (2026-10-22)
- **Consequences:** HEN-58 builds the schema, RLS and the `bjj_auth_lookup` function as SQL migrations, plus the email-hash adapter wrapper. See `docs/spikes/HEN-47-better-auth.md`.

## D17: Sign-in is email OTP plus Apple and Google, with no passwords (revised)

Revised from planning D17 (email OTP + magic link) on 2026-10-27 for HEN-238.

- **Decision:** Better Auth runs sign-in. The methods are email OTP (a 6-digit code, primary), magic link, Sign in with Apple and Google sign-in. There
  are no passwords. SMS is not a sign-in method (see D25).
- **Rejected alternatives:** Supabase Auth (GoTrue), self-hosted; Lucia-style own sessions (planning log §B).
- **Date:** 2026-10-15 (planning D17); revised 2026-10-22 and 2026-10-25 (Henry)
- **Decided by:** Sara (method and library); Henry (Apple and Google on top of email OTP)
- **Consequences:** HEN-239 builds Apple and Google through Better Auth social providers. On the phone, session tokens live only in SecureStore
  (`@better-auth/expo`).

## D18: Every stored email and phone number is field-encrypted with an HMAC lookup hash (revised)

Revised from planning D18 on 2026-10-27 for HEN-238.

- **Decision:** Every stored email uses AES-256-GCM field encryption plus an HMAC-SHA256 lookup hash, with a `key_version` for rotation. This covers
  emails typed for OTP, emails from Apple or Google, and Apple private-relay addresses. A phone number (when HEN-240 ships) uses the same pattern.
- **Date:** 2026-10-15 (planning D18); revised 2026-10-22
- **Decided by:** Sara; revision approved by Henry with the sign-in mix (D25)
- **Consequences:** Social sign-in emails go through the same codec as OTP emails (`authCodecTransform.ts`), so account lookup and linking use the
  HMAC only. Where the keys live: KMS choice OPEN (HEN-191).

## D19: The account holds only an email, a handle and linked provider ids (revised)

Revised from planning D19 on 2026-10-27 for HEN-238.

- **Decision:** An account holds only the encrypted email, the handle and, per linked provider, the provider id and the provider's stable user id
  (`sub`). No name, photo or other profile field from Apple or Google is stored. The only provider token kept is the Apple refresh token, encrypted,
  used only to revoke Sign in with Apple when the account is deleted. No Google tokens are kept.
- **Date:** 2026-10-15 (planning D19); revised 2026-10-22
- **Decided by:** Sara and Henry; revision approved by Henry with the sign-in mix (D25)
- **Consequences:** HEN-239 drops provider profile fields and Google tokens after sign-in. Account deletion revokes the Apple token before the account
  rows are deleted (ARCHITECTURE §5). The encryption inventory lists the provider ids and the Apple token (ARCHITECTURE §6).

## D24: Owner can see their own footage unmasked

Renumbered from D22 on 2026-10-22 (collided with planning D22, masking).

- **Decision:** Owner can see their own footage unmasked.
- **Date:** 2026-10-17
- **Decided by:** Henry
- **Consequences:** The label set stays open under HEN-44.

## D25: Sign-in mix: Apple and Google on top of email OTP; SMS only as a one-time phone check

- **Decision:** Sign in with Apple and Google sign-in are added on top of email OTP, not as a replacement. Both ship at launch. SMS is only a one-time
  phone check (one account per phone, against fake ranks), never a login method.
- **Rejected alternative:** Replacing email OTP with Apple/Google; SMS as a login method.
- **Date:** 2026-10-22 and 2026-10-25
- **Decided by:** Henry
- **Consequences:** App Store rule 4.8 is met by offering Sign in with Apple next to Google sign-in. Every sign-up path (email, Apple, Google) has the
  same 16+ gate (HEN-263). The phone check is built later in HEN-240 and stores the number per D18. HEN-239 builds the sign-in code.
