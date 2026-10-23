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

## D24: Owner can see their own footage unmasked

Renumbered from D22 on 2026-10-22 (collided with planning D22, masking).

- **Decision:** Owner can see their own footage unmasked.
- **Date:** 2026-10-17
- **Decided by:** Henry
- **Consequences:** The label set stays open under HEN-44.
