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
- **Drift thresholds (UNTUNED):** `MIN_TRACK_SCORE` 0.5, `MAX_CENTRE_JUMP_IN_BOX_DIAGONALS` 0.5 and `MAX_AREA_CHANGE_RATIO` 2.0 in `drift_detector.py`
  are first guesses and are not tuned on real footage. HEN-67 tunes them.
- **Date:** 2026-10-30
- **Decided by:** Sara (her calls, 30 Oct 07:59 CET) (HEN-318)
- **Consequences:** The pose runner (HEN-319) uses the same coordinate types (`geometry.py`). A real local run needs its own venv and weights (not in the repo).

## D34: A corrupt pending sign-out queue fails closed (Bill D4, HEN-321)

- **Decision:** A stored pending sign-out queue that can't be read is treated as wholly unreadable, including a JSON list cut off mid-write. It takes
  the same fail-safe path as any other corrupt queue (Bill D4, HEN-315): the next launch signs out the stored session and clears the queue, so auth fails
  closed. No entry is salvaged from a cut-off queue, by partial or hand parsing; none is dropped silently, and nothing crashes.
- **Rejected alternative:** Salvaging the readable entries and dropping the bad ones (HEN-321's original "drop bad entries" criterion, superseded).
- **Date:** 2026-10-31
- **Decided by:** Sara (option a)
- **Consequences:** `packages/mobile/src/auth/pendingSignOuts.ts` keeps its fail-safe parsing unchanged. `pendingSignOuts.hardening.test.ts` pins the
  cut-off case: only the stored session is signed out, and the queue is cleared.
