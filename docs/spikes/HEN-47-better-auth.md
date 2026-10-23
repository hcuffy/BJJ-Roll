# HEN-47 spike: Better Auth with a hashed email column

Status: **proposed, pending Sara's sign-off** (AC 8). Time box: one night, 2026-10-22.

Versions: `better-auth` 1.7.7, `@better-auth/expo` 1.7.7, `@better-auth/kysely-adapter` 1.7.7, `kysely` 0.29.6, Expo SDK 57, Postgres `18.6`.

Proof code lives only in tests: `packages/backend/src/__tests__/betterAuthSpike.*.test.ts` and the helpers in `packages/backend/src/__tests__/betterAuthSpike/`. Keys and secrets are generated inside the tests; email goes to an in-memory fake sender.

## 1. Sign-in by `email_hash` with no plaintext email column (AC 1)

**Yes**, with a thin adapter wrapper (`protectedAdapter.ts`, about 130 lines).

- `user.fields.email = "emailHash"` maps Better Auth's `email` field to the `email_hash` column. There is no `email` column.
- The wrapper turns every `email` value and `where` clause on the user model into `HMAC-SHA256(hmacKey, lower(trim(email)))`. It also writes `email_ciphertext` (AES-256-GCM, separate data key) and decrypts it on read, so Better Auth and the API still see the real address.
- A wrapper is needed because Better Auth's field `transform.input` is not applied to `where` clauses.
- Verification rows: `verification.storeIdentifier: { hash }` hashes the identifier (otherwise it is `sign-in-otp-<email>` in plain text). The wrapper encrypts `verification.value`, because the magic-link value is JSON that holds the email.
- The test dumps every auth table after sign-in and finds neither the email nor the code.

No fallback is needed. `HEN-58` should turn the wrapper into real code next to the D18 encryption module (`HEN-63`), with the keys from the key store and not generated per process.

## 2. Migration tool and DB access layer (AC 2)

**Proposal:**

- **DB access layer: Kysely** (`kysely` + `@better-auth/kysely-adapter`, with `CamelCasePlugin` for snake_case columns).
- **Migration tool: Kysely's `Migrator`** with plain SQL migrations in `packages/backend/src/database/migrations/`.
- **Our migrations own Better Auth's tables.** Better Auth's CLI `migrate` is never run. Its `generate` command may be used to read what a Better Auth upgrade expects, and the result is copied by hand into a migration.

Reasons:

- Kysely is Better Auth's own built-in adapter, so there is one query layer for auth and app code and no second ORM.
- Kysely is a typed SQL builder, not an ORM. RLS, `SET LOCAL app.user_id`, roles and `SECURITY DEFINER` functions stay plain SQL that we can read and review.
- Migrations in SQL fit the RLS-heavy schema (`FORCE ROW LEVEL SECURITY`, policies, grants) and the Python workers, which read the same tables.
- Owning the tables lets us choose `email_hash` and `email_ciphertext`, snake_case names, RLS and grants. Better Auth's `migrate` would create an `email` column and no RLS.

Rejected alternatives: Drizzle ORM + drizzle-kit (a second schema DSL, and RLS and grants still end up as raw SQL); node-pg-migrate or dbmate (fine runners, but a second tool next to Kysely); raw `pg` (no types; Better Auth would still need an adapter).

Recorded as a proposed entry, **A4**, in `DECISIONS.md`.

## 3. Better Auth 1.7.7 options for the security controls (AC 3)

| Control                      | Works in 1.7.7?  | Option or code path                                                                                                                                                                      |
| ---------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OTP stored hashed            | Yes              | `emailOTP({ storeOTP: { hash } })`. Do not use `storeOTP: "hashed"`: it is unkeyed SHA-256, and a 6-digit code can be brute-forced from it. The spike passes an HMAC with a server key.  |
| Magic-link token hashed      | Yes              | `magicLink({ storeToken: { type: "custom-hasher", hash } })`, plus `verification.storeIdentifier: { hash }` (the token is the identifier).                                               |
| Max attempts per code        | Yes (OTP)        | `emailOTP({ allowedAttempts: 5 })`, counted in the verification row and checked atomically. A magic link has no attempts: it is consumed on first use (`allowedAttempts` is deprecated). |
| OTP expiry                   | Yes              | `emailOTP({ expiresIn: 600 })` (default 300 s).                                                                                                                                          |
| Magic-link expiry            | Yes              | `magicLink({ expiresIn: 900 })` (default 300 s).                                                                                                                                         |
| Rate-limit state in Postgres | Yes (per IP)     | `rateLimit: { enabled: true, storage: "database", modelName: "rateLimits", customRules }`. Off outside production by default, so set `enabled: true`.                                    |
| Rate limit per email         | **Not built in** | Better Auth keys limits on IP + path only. The spike adds a `hooks.before` that counts sends per `email_hash` in the same `rate_limits` table (3 per 15 min).                            |
| Client IP                    | Yes              | `advanced.ipAddress.ipAddressHeaders`. It must name only the header our proxy sets, or the per-IP limit can be bypassed.                                                                 |
| Session 30 days, sliding     | Yes              | `session: { expiresIn: 2592000, updateAge: 86400 }`.                                                                                                                                     |
| 90-day absolute session cap  | **Not built in** | Needs a hook or a check against `sessions.created_at` in `HEN-71`. Not built in the spike.                                                                                               |

## 4. End-to-end test (AC 4)

`betterAuthSpike.emailOtpSignIn.test.ts` runs Hono → Better Auth → Kysely → Testcontainers `postgres:18.6`: send code, verify code, session returned (`get-session` expires in about 30 days). It also covers the attempt limit, OTP expiry, hashed storage and the email and IP limits. `betterAuthSpike.magicLinkAndLookup.test.ts` covers magic-link sign-in to `bjjroll://`, single use, 15-minute expiry and the RLS lookup. Like the existing container test, these tests skip locally without Docker and always run in CI.

## 5. Expo SDK 57 (AC 5)

- `@better-auth/expo` 1.7.7 and `better-auth` 1.7.7 are pinned exactly in `packages/mobile`. `expo-secure-store`, `expo-linking`, `expo-constants`, `expo-web-browser` and `expo-network` were added with `expo install`.
- `expo install` first picked `expo-constants` 57.0.22, `expo-linking` 57.0.13 and `expo-network` 57.0.3. All three are under 14 days old, so the 14-day rule refused them, and the previous SDK 57 patches were installed instead (57.0.21, 57.0.12, 57.0.2). Expo warns that these differ from its recommended patch.
- `app.json` gets `scheme: "bjjroll"` and the `expo-secure-store` and `expo-web-browser` config plugins.
- An Expo client (`createAuthClient` + `expoClient` with SecureStore, `emailOTPClient`, `magicLinkClient`) typechecked and bundled for Android and iOS on the spike branch. It is not committed, because proof code stays in tests. `HEN-71` builds the real client.
- **The Expo client reaching the dev backend: not tried** (no device or simulator in the spike environment).
- Finding for `HEN-71`: after a magic link, the Expo plugin passes the session cookie to the app inside the `bjjroll://` redirect URL. A custom scheme can be claimed by another app, so `HEN-71` should consider Android App Links / iOS Universal Links for the callback.

## 6. Pre-session lookup under FORCE RLS (AC 6)

**Yes.**

- The spike builds Sara's design:
  - `bjj_auth_lookup` is NOLOGIN with no BYPASSRLS and has a SELECT-only users policy.
  - `auth_lookup_user_id(email_hash text) RETURNS text` is `SECURITY DEFINER`, owned by `bjj_auth_lookup`, with `SET search_path = pg_catalog, pg_temp`.
  - `EXECUTE` is revoked from PUBLIC and granted to `bjj_app` only.
- Better Auth's `findUserByEmail` arrives at the adapter as `findOne(user, where email = ?)`. The wrapper sends that call to the function as `bjj_app` (`SET LOCAL ROLE bjj_app`) and then loads the user by id. The test checks that the lookup ran, that `bjj_app` sees 0 users rows directly, and the role and function catalogue.

Open points for `HEN-58`:

- The lookup runs on its own connection, not inside Better Auth's transaction.
- Better Auth also needs pre-session access to sessions (by token), verifications and rate_limits. Those tables need their own policy or role.
- In the spike the other queries run as the container superuser.
