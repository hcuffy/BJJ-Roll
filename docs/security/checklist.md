# Security self-check (OWASP MASVS L1 + ASVS-style API checks)

Our own checklist, not an audit. It covers every OWASP MASVS group at L1 for the mobile app, ASVS-style checks for the API, Postgres row-level security
(RLS) and IDOR, and the time-boxed reviewer grants from the [architect doc](../ARCHITECTURE.md) (§4). Each row names the issue that owns it.

- **Status:** `todo` (not built or not checked yet), `done` (built and checked, proof in the owner issue), `n/a` (does not apply, reason given).
- **Passes:** the full pass before testers is HEN-233 (M4-32; blocks HEN-99). The pre-payment pass that replaces the external pentest is HEN-235 (M10-19;
  blocks HEN-213 live mode). Both work through this file and set every row to `done` or `n/a` with a reason.
- **Reporting:** see [`SECURITY.md`](../../SECURITY.md).

## Mobile app: MASVS L1

| ID  | MASVS group      | Check                                                                                                                      | Owner issue               | Status |
| --- | ---------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------ |
| M1  | MASVS-STORAGE    | Session tokens only in iOS Keychain / Android Keystore (SecureStore), never in AsyncStorage or files (D17)                 | HEN-78                    | todo   |
| M2  | MASVS-STORAGE    | Recordings waiting for upload stay in the app sandbox and are deleted after a confirmed upload                             | HEN-86                    | todo   |
| M3  | MASVS-STORAGE    | No email, token or video URL in app logs, crash reports or analytics                                                       | HEN-86                    | todo   |
| M4  | MASVS-CRYPTO     | No home-made crypto in the app; any on-device encryption uses platform APIs or the shared module                           | HEN-63                    | todo   |
| M5  | MASVS-AUTH       | Sign-in is server-side (Better Auth email OTP, Apple, Google); the app never decides access on its own                     | HEN-78, HEN-239           | todo   |
| M6  | MASVS-AUTH       | Sign-out and account deletion clear local tokens and cached data                                                           | HEN-65                    | todo   |
| M7  | MASVS-NETWORK    | HTTPS only (no cleartext traffic allowed in the Android/iOS config); TLS for the API, tus uploads and presigned URLs       | HEN-80                    | todo   |
| M8  | MASVS-PLATFORM   | Deep links and magic links cannot sign in another account or open another user's video; links are single use               | HEN-71                    | todo   |
| M9  | MASVS-PLATFORM   | Only the permissions we use (camera, microphone, notifications); each one asked for in context                             | HEN-86, HEN-196           | todo   |
| M10 | MASVS-PLATFORM   | No sensitive data in push notification text (ids only, content fetched after unlock)                                       | HEN-196                   | todo   |
| M11 | MASVS-CODE       | Dependencies scanned on every PR and nightly (OSV-Scanner), with time-boxed exceptions only                                | HEN-222                   | done   |
| M12 | MASVS-CODE       | Secret scanning (gitleaks in CI, leakcheck pre-commit), static analysis (CodeQL), SHA-pinned CI actions                    | HEN-223, HEN-224, HEN-225 | done   |
| M13 | MASVS-CODE       | Release builds: debugging off, dev menu off, minimum OS versions set; MobSF scan of the release builds                     | HEN-184, HEN-230          | todo   |
| M14 | MASVS-RESILIENCE | Not an L1 requirement. Device attestation (Play Integrity, App Attest) is planned only for payment, payout and review APIs | HEN-234                   | n/a    |
| M15 | MASVS-PRIVACY    | Data collected matches the store privacy label and Data safety form, from the architect doc data flows                     | HEN-185, HEN-237          | todo   |
| M16 | MASVS-PRIVACY    | Consent recorded before footage goes to the AI vendor, a gym mate or a reviewer (`consent_third_party`)                    | HEN-190, HEN-69           | todo   |

## API: ASVS-style checks

| ID  | Area             | Check                                                                                                                 | Owner issue      | Status |
| --- | ---------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------- | ------ |
| A1  | Authentication   | OTP and magic links: short expiry, single use, rate limited per email and per IP; codes stored hashed if supported    | HEN-71, HEN-47   | todo   |
| A2  | Sessions         | Session tokens random, revocable, expired server-side; sign-out and account deletion end every session                | HEN-71, HEN-65   | todo   |
| A3  | Access control   | Every route checks the session and runs inside the RLS context (`SET LOCAL app.user_id`); deny by default             | HEN-58           | todo   |
| A4  | Input validation | Every request body, job payload and job result is parsed with the shared Zod schemas; job payloads reject extra keys  | HEN-46, HEN-48   | todo   |
| A5  | Data protection  | Email encrypted at field level with a lookup hash (D18); no card, bank or ID data stored                              | HEN-63, HEN-191  | todo   |
| A6  | Logging          | No email, IP, URL or filename in logs; audit log holds ids and timestamps only                                        | HEN-50, HEN-227  | todo   |
| A7  | Communications   | TLS everywhere; presigned URLs short-lived (300 s playback, 15 min workers)                                           | HEN-50, HEN-193  | todo   |
| A8  | Configuration    | Production secrets only in the deploy platform, never in the repo; staging ZAP baseline nightly; server image scanned | HEN-228, HEN-229 | todo   |
| A9  | Business logic   | Paid review checkout, refunds and payouts cannot be replayed or skipped (abuse cases in the pre-payment pass)         | HEN-213, HEN-235 | todo   |
| A10 | Admin            | Admin dashboard is Henry-only, separate from the app, and every admin action is audit-logged                          | HEN-241          | todo   |

## Postgres RLS and IDOR

| ID  | Check                                                                                                                     | Owner issue     | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------- | --------------- | ------ |
| R1  | `bjj_app` is not the table owner, has no `BYPASSRLS`, and `FORCE ROW LEVEL SECURITY` is on for every user-data table      | HEN-58          | todo   |
| R2  | User B cannot read, update or delete user A's rows through the API or as the app DB role (negative tests, Testcontainers) | HEN-58          | todo   |
| R3  | Missing session context (`app.user_id` unset) returns no rows                                                             | HEN-58          | todo   |
| R4  | Ids are random UUIDs; an id the caller never had access to gives 404, so ids cannot be probed                             | HEN-58, HEN-193 | todo   |
| R5  | Group and gym visibility policies only match members, and never return the source video object key                        | HEN-68, HEN-83  | todo   |
| R6  | Policy helper functions are owned by `bjj_policy_helper` (no login, owns nothing else), so policies cannot recurse        | HEN-193         | todo   |

## Reviewer and gym-mate grants (architect doc §4.4)

| ID  | Check                                                                                                                   | Owner issue      | Status |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ---------------- | ------ |
| G1  | Reviewer grants always have `expires_at` and a `review_request_id`; `grantee_id <> owner_id`                            | HEN-193          | todo   |
| G2  | An expired or revoked grant gives 403 on the next API call and returns no rows                                          | HEN-193          | todo   |
| G3  | Presigned URLs live 300 s, or less if the grant ends sooner; grantees only ever get the masked render                   | HEN-193, HEN-81  | todo   |
| G4  | No grant while either user blocks the other or while the video is restricted after a minor-visible report               | HEN-199, HEN-200 | todo   |
| G5  | A grant needs the matching `consent_third_party` record first                                                           | HEN-193, HEN-194 | todo   |
| G6  | Submitting a review revokes the reviewer grant (`review_delivered`)                                                     | HEN-212          | todo   |
| G7  | Deleting a video kills its grants, renders, notes and URLs in the same job                                              | HEN-101, HEN-95  | todo   |
| G8  | A reviewer cannot list or guess other videos; grant create, revoke and denied-access events are audit-logged (ids only) | HEN-193          | todo   |
