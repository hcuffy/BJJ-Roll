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
- **Python:** The package accepts Python >= 3.13 (`requires-python`); `.python-version` (3.15.0) is the default uv picks. CI runs 3.13 and 3.15, and
  the real ONNX run uses 3.13 (onnxruntime has no 3.15 wheel; HEN-318, HEN-319). Dependencies are managed with uv, with a committed `uv.lock`.
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

## A6: One coarse position set for gi and no-gi; ViCoS classes are eval-only

- **Decision:** Label set v1 (HEN-44) is one coarse set shared by gi and no-gi. Level 1 (18 positions, 9 events) is the scoring set for both styles; only level 2 details marked [Gi] are hidden for no-gi videos. ViCoS classes are used for evaluation only, never as our labels (D7).
- **Date:** 2026-10-29
- **Decided by:** Sara (2026-10-29)
- **Consequences:** The file is `packages/workers/src/bjj_roll_workers/label_set_v1.json` with its loader and ground-truth validator in `label_set.py` (HEN-316). v0 (HEN-66) and v1 (HEN-79) score against it. Every id is snake_case and stable; each level 2 detail keeps its source name as a free-text `label`. `mount_escape` is one detail with an optional ground-truth `variant` (upa, elbow_knee, to_half) (Sara, 2026-10-30). The level 1 definitions below are a draft and need Sara's OK.

| Lane | id                 | Definition (draft)                                                                                |
| ---- | ------------------ | ------------------------------------------------------------------------------------------------- |
| A    | `standing`         | Both athletes on their feet and not tied up.                                                      |
| A    | `clinch`           | Both on their feet and tied up at the upper body (collar tie, underhooks, bodylock).              |
| A    | `closed_guard`     | The bottom athlete's legs are locked around the top athlete's waist.                              |
| A    | `half_guard`       | The bottom athlete traps one of the top athlete's legs between their legs.                        |
| A    | `open_guard`       | The bottom athlete controls the top athlete with legs and hooks, without a lock or a trapped leg. |
| A    | `headquarters`     | The top athlete has one knee between the bottom athlete's legs, pinning a leg, before a pass.     |
| A    | `side_control`     | The top athlete is past the legs and pins the bottom athlete chest to chest from the side.        |
| A    | `north_south`      | The top athlete pins the bottom athlete chest to chest, head to the bottom athlete's legs.        |
| A    | `knee_on_belly`    | The top athlete has a knee on the bottom athlete's torso, with the other leg posted.              |
| A    | `mount`            | The top athlete sits astride the bottom athlete's torso.                                          |
| A    | `back_control`     | One athlete is behind the other and controls the back with hooks or chest to back.                |
| A    | `turtle`           | One athlete is face down on knees and elbows, curled up.                                          |
| A    | `front_headlock`   | One athlete controls the head and an arm of a facing opponent who is down on knees or hands.      |
| A    | `crucifix`         | One athlete is beside or behind the opponent and traps both of their arms.                        |
| A    | `truck`            | One athlete is behind a turtled opponent and locks a leg around one of their legs.                |
| A    | `leg_entanglement` | Both athletes' legs are tangled, each controlling a leg for leg-lock attacks.                     |
| A    | `scramble`         | A fast exchange with no stable position (fallback).                                               |
| A    | `unknown`          | The model is unsure, or the athletes are off camera (fallback).                                   |
| B    | `takedown`         | An athlete brings a standing opponent to the ground and ends on top.                              |
| B    | `guard_pull`       | An athlete sits or jumps from standing into guard.                                                |
| B    | `guard_pass`       | The top athlete gets past the bottom athlete's legs to a pin.                                     |
| B    | `sweep`            | The bottom athlete reverses the position from guard and ends on top.                              |
| B    | `back_take`        | An athlete reaches back control.                                                                  |
| B    | `submission`       | A choke, joint lock or crank is applied; outcome is `attempt`, `defended` or `finish`.            |
| B    | `escape`           | An athlete gets out of a pin, back control or a submission.                                       |
| B    | `transition`       | A move between positions that is not a pass, sweep, back take or escape.                          |
| B    | `reset`            | The roll restarts from standing (referee or partner reset, both stand).                           |

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

## D20: Transactional email provider is Lettermint (NL)

- **Decision:** Sign-in and notice emails are sent through Lettermint (Netherlands, EU-only infrastructure).
- **Rejected alternatives:** Scaleway TEM (Paris) as the runner-up; Brevo/Mailjet (marketing-first platforms) and US providers (planning log D20).
- **Date:** 2026-10-15
- **Decided by:** Henry
- **Consequences:** The Lettermint DPA is read before go-live (HEN-118). The account, sending domain and real-send check are Henry's (HEN-262). Tests
  use a fake sender, so no Lettermint credentials are needed to build or test.

## D24: Owner can see their own footage unmasked

Renumbered from D22 on 2026-10-22 (collided with planning D22, masking).

- **Decision:** Owner can see their own footage unmasked.
- **Date:** 2026-10-17
- **Decided by:** Henry
- **Consequences:** The label set stays open under HEN-44.

## D25: Sign-in mix: Apple and Google on top of email OTP; SMS only as a one-time phone check

- **Decision:** Sign in with Apple and Google sign-in are added on top of email OTP, not as a replacement. SMS is only a one-time phone check (one
  account per phone, against fake ranks), never a login method.
- **Launch:** Apple is built at launch, with `appleEnabled` false until the Apple developer account exists (HEN-181). Android shows email and Google,
  with Apple hidden. iOS shows email only while Apple is off, then email, native Apple and Google once it's on
  (`packages/mobile/src/auth/socialSignIn.ts:44`, Apple rule 4.8).
- Apple sign-in is iOS-only and hidden on Android.
- **Rejected alternative:** Replacing email OTP with Apple/Google; SMS as a login method.
- **Date:** 2026-10-22 and 2026-10-25
- **Decided by:** Henry
- **Consequences:** App Store rule 4.8 is met by offering Sign in with Apple next to Google sign-in. Every sign-up path (email, Apple, Google) has the
  same 16+ gate (HEN-263). The phone check is built later in HEN-240 and stores the number per D18. HEN-239 builds the sign-in code.

## D26: Interim key storage is two separate deploy-time secrets

- **Decision:** Until a KMS is chosen, the email encryption keys are two separate secrets injected at deploy time: a data key (AES-256-GCM field
  encryption, D18) and an HMAC key (email lookup hash). They are separate random keys; neither is derived from the other. No KMS and no key vendor for
  now.
- **Where the secrets must never appear:** the repo, CI secrets, logs and the database. Tests generate their own throwaway keys.
- **Rejected alternative:** Picking a KMS or key vendor now (stays open).
- **Date:** 2026-10-22
- **Decided by:** Sara
- **Consequences:** The encryption module (HEN-63) reads the keys through a keyring interface, so a KMS / KEK wrapping can replace the secrets later
  without a schema change. The KMS choice stays OPEN under HEN-191 (M4). ARCHITECTURE §6 email row points here.

## A7: Local CPU tracker runs in 30 s chunks at 10 fps with a 15 s fallback over 3 GiB peak RSS

- **Decision:** The tracker runner (HEN-318) samples frames at 10 fps and tracks in 30 s chunks (300 frames) that overlap by 1 s; each chunk is
  re-prompted from the previous chunk's masks. Peak RSS is logged per chunk; once it is over 3 GiB (3221225472 bytes), the following chunks drop to 15 s.
  The values live in `packages/workers/src/bjj_roll_workers/tracker_config.json` and are read from there, not hard-coded.
- **Model:** SAM 2.1 small (Apache-2.0) as an ONNX export on onnxruntime's CPU provider, behind one `Tracker` interface so a Modal backend can replace it.
  numpy and onnxruntime are not CI dependencies (onnxruntime has no Python 3.15 wheel); CI runs a fake model only.
- **ONNX export:** We export SAM 2.1 small ourselves from Meta's Apache-2.0 checkpoint with `packages/workers/scripts/export_sam21_small_onnx.py`
  (see `packages/workers/scripts/README.md`). We never download the onnx-community export, because it carries no licence. The real export run
  happens in HEN-67, not in HEN-318.
- **Drift thresholds (UNTUNED):** `MIN_TRACK_SCORE_UNTUNED` 0.5, `MAX_CENTRE_JUMP_IN_BOX_DIAGONALS_UNTUNED` 0.5 and `MAX_AREA_CHANGE_RATIO_UNTUNED` 2.0 in `drift_detector.py`
  are first guesses and are not tuned on real footage. HEN-67 tunes them.
- **Date:** 2026-10-30
- **Decided by:** Sara (her calls, 30 Oct 07:59 CET) (HEN-318)
- **Consequences:** The pose runner (HEN-319) uses the same coordinate types (`geometry.py`). A real local run needs its own venv and weights (not in the repo).

## A8: Local CPU pose runs RTMPose-m (COCO-17) at the tracker's 10 fps with 2 ONNX Runtime threads

- **Decision:** The pose runner (HEN-319) runs RTMPose-m (body7, 256x192, COCO-17 keypoints in COCO order) as ONNX on onnxruntime's CPU provider,
  behind one `Pose` interface (`estimate(frame, box)`) so a Modal backend can replace it. Frames come at the tracker's fps (10, A7); one session
  uses 2 intra-op threads. Both values live in `packages/workers/src/bjj_roll_workers/pose_config.json` and are stored with every run.
- **Bench:** each run records the tangled-frame miss rate (definitions and named thresholds in `pose_bench.py`).
- **Tangled-frame thresholds (UNTUNED):** `TANGLED_BOX_IOU_THRESHOLD` 0.3, `MIN_KEYPOINT_SCORE` 0.3, `MIN_POSE_MEAN_SCORE` 0.3 and
  `MIN_OWN_MASK_KEYPOINT_FRACTION` 0.5 in `pose_bench.py` are first guesses, not tuned on real footage. HEN-67 and HEN-73 tune them with footage.
- **Threads:** 2 ONNX Runtime intra-op threads stays. The HEN-67 smoke run measures it.
- **Licence (UNCONFIRMED):** the RTMPose-m weights licence is not confirmed, and the body7 training data (AI Challenger, PoseTrack18) has
  research-only terms. This is OK for the M3 local test (no users, nothing shipped). It BLOCKS any store build until it is cleared. Shipping is a
  legal call: it goes to the lawyer list (HEN-208) through Drago.
- **Wiring:** the tracker-to-pose wiring lives in HEN-67 (pipeline). HEN-73 only consumes the pose output.
- **Date:** 2026-10-30
- **Decided by:** Henry and Sara (HEN-319); licence, threads, thresholds and wiring: Sara, 30 Oct 13:57 CET
- **Consequences:** Only the user's own keypoints are stored (D6). numpy and onnxruntime are not CI dependencies; a real run uses the HEN-318 private venv.
  No store build ships the pose runner until the licence is cleared.

## D27: Auth limits, codes and try budgets (moved from code comments)

- **Decision:** 6-digit OTP, 10-minute OTP expiry, 5 tries per OTP, 15-minute magic link, 60 s deep-link exchange code. Rate-limit window 15 minutes:
  3 sends per email, 10 sends per IP, 20 verification tries per IP. Sessions slide over 30 days (refreshed at most once a day), 90 days at most.
- **Per-email send counter:** Better Auth's limiter keys on IP + path only, so we count sends per email in `public.rate_limits`, keyed by the email
  HMAC (same as `users.email_hash`), as a fixed window from the first send, with one atomic upsert per request. Clients with no known IP share one
  bucket (fails closed). `rate_limits` is not in the account deletion cascade map: its counters (hash or id only) age out with their window,
  so deleting the account and signing up again cannot reset the send limit or the delete-code tries.
- **Delete code:** reuses the email-OTP machinery (same CSPRNG code, keyed hash at rest, 10-minute expiry, send counter) and goes only to the
  signed-in user's own address. DELETE /account has its own atomic try budget: per user, `OTP_MAX_ATTEMPTS` tries per code, reset only by a new code;
  the 15-minute window outlives the 10-minute code. Per IP, the auth verify limit. Over HTTP, check-verification-otp only checks sign-in codes,
  so it is not a guessing oracle outside that budget. Neither the delete code nor DELETE /account is ever gated on the sign-up attestation.
- **Date:** 2026-10-31 (decided 2026-10-22 to 2026-10-25)
- **Decided by:** Sara (HEN-71), Henry (25 Oct, HEN-65), Bill's gate (HEN-65)
- **Consequences:** Values live in `authLimits.ts`; any change updates this entry.

## D28: No answer reveals whether an account exists

- **Decision:** Sign-in sends do the same work for every email (known, unknown, or refused by the age gate): one queued job, no wait on the
  provider, and the same session-scope query on an id no row has. Social sign-in refusals are one neutral `account_not_linked` redirect with
  nothing that differs between attempts; an Apple or Google email counts only with an explicit verified claim. App copy never says whether an email
  is signed up.
- **Date:** 2026-10-31 (moved from code comments)
- **Decided by:** Sara (HEN-239, HEN-263)
- **Consequences:** New auth responses and copy must keep this; tests in `auth.ageGate.sameWork*` and `authCopy.noAccountExistence` pin it.

## D29: The only stored provider token is Apple's refresh token, for revoke on deletion

- **Decision:** Provider tokens are dropped, except Apple's refresh token, stored encrypted (marked so it is never encrypted twice) so account
  deletion can revoke it (App Store rule 5.1.1(v)). A failed code exchange never blocks sign-in and a failed revoke never blocks deletion; both
  are logged by user id only.
- **Date:** 2026-10-31 (moved from code comments)
- **Decided by:** Sara (HEN-239)
- **Consequences:** The account deletion notice is queued; a failure to queue it is logged and the deletion still succeeds.

## D30: Email queue retries and idempotency

- **Decision:** Every email sent after a request goes through a pg-boss queue (own `pgboss` schema), so no response waits on the provider.
  3 tries in all, with a doubling, jittered backoff; a try counts as failed only well past the provider's 10 s timeout. 408, 409 and 429 are retried;
  other 4xx answers, configuration errors and payloads that cannot be opened are not. The job id is also the provider idempotency key (Lettermint
  sends once per key for 24 h), so the same request twice, or a retry after a timeout, sends one email. The final-failure log line holds only the
  job id, template, a fixed error class and the try count.
- **Date:** 2026-10-31 (moved from code comments)
- **Decided by:** Sara (HEN-284)
- **Consequences:** Tests use an inline queue double; the real queue is covered by `emailQueue.*` and `auth.ageGate.sameWork.queued`.

## D31: Mobile startup budget and pending sign-out queue

- **Decision:** All of startup (sign-out retry, session read, link exchange, the gate's first status read) shares one 10 s budget; a timeout counts
  as an unreachable server. The lock and the biometric offer wait on the user, so the status read after them gets its own 10 s. A sign-out is
  queued before it runs; each queued session is removed only on its own confirmed server sign-out, or once it is older than any server session can
  live. A timed-out request leaves keys and queue as they are, so a late answer cannot touch a newer session. Queue writes never overlap. A sign-out
  stops and awaits any running revoke from a sign-in or launch, so one session is never revoked twice at once. A failed revoke never blocks sign-in.
- **Date:** 2026-10-31 (moved from code comments)
- **Decided by:** Sara's design, Bill's and Stamp's gates (HEN-299, HEN-303, HEN-310, HEN-314, HEN-315)
- **Consequences:** The `App.*` startup and sign-out tests pin these rules.

## D32: Modal jobs stay in the EU; encryption stays server-only

- **Decision:** Node calls Modal user-data functions with `.remote()` only, and results stay under 2 MiB, so data never routes through Modal's
  us-east storage. Every user-data function sets `region="eu"`, `routing_region="eu-west"` and `enable_memory_snapshot=False`, and uses no Volumes,
  Dicts, Queues or bucket mounts; the video comes through a presigned URL. `@bjj-roll/shared/encryption` uses `node:crypto` and key handling, so it
  is never re-exported from the shared index and ESLint blocks it in mobile and web code.
- **Date:** 2026-10-31 (moved from code comments)
- **Decided by:** Sara (HEN-48 option A, HEN-63, HEN-227)
- **Consequences:** `checkModalResidency.sh` and the residency tests check this statically.

## D33: No code comments; rationale lives here

- **Decision:** TS/JS and Python source has no comments or docstrings. Only tool directives stay: `eslint-disable-next-line … -- reason`,
  `@ts-expect-error reason`, `/// <reference …/>`, a licence header, shebangs, `# noqa: CODE - reason` and `# type: ignore[code]  # reason`.
  Names carry meaning: unknown values end in `Placeholder` (Henry decides, ARCHITECTURE §2) or `_UNTUNED` (HEN-67 tunes them).
  `eslint-config-prettier` turns off `curly` and `max-len`; both are turned back on, as they are safe with Prettier at width 150.
- **Date:** 2026-10-31
- **Decided by:** Henry, via Sara (HEN-333)
- **Consequences:** `local/no-prose-comments` (ESLint) and `packages/workers/scripts/check_no_comments.py` fail CI on a new comment.
