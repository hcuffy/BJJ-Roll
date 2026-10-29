# Architecture (M1-02, HEN-41)

Design doc for BJJ-Roll before feature code (D21). It covers the module layout, the shared Zod types, the Hono ↔ worker job contract on pg-boss, the
Postgres row-level security (RLS) model including reviewer access grants and gym-mate sharing, the cascade-delete map, the encryption inventory and a UI
kit recommendation for HEN-46.

**Status:** approved by Sara (CTO), 2026-10-22. Her decisions are recorded in §7. The open questions for Henry and the lawyer stay open and do not block this doc.

**Security checklist:** [`docs/security/checklist.md`](security/checklist.md) tracks the MASVS/ASVS, RLS/IDOR and grant checks for this design (HEN-226).

## 0. How to read this doc

- **A decision id or issue key** (D-, A- or H-number, `HEN-n`) means the point is already recorded there: A1–A4, D17–D19 (revised), D20, D24, D25
  and D26 in [`DECISIONS.md`](../DECISIONS.md), the other D1–D23 in Sara's planning decision log, H1–H13 in Henry's planning answers, or the Linear
  issue.
- **[Proposal]** means a technical choice made in this doc. Sara approves or changes it in review. Once approved, durable choices go into `DECISIONS.md`.
- **OPEN (owner)** means not decided anywhere. The owner decides: Henry (product, money), Sara (tech) or the lawyer (legal). This doc does not pick an
  answer for these.
- Linear keys are written as `HEN-n`, with the outline key (for example M6-09) where it helps.
- Nothing here is legal advice. Every legal point goes to the German data-protection lawyer.

### Decisions this doc builds on

| Ref                      | Decision                                                                                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1                       | React Native + Expo + VisionCamera, iOS and Android from one codebase (both stores since the 2026-10-18 plan change); the web app is the review UI |
| D2                       | Inference runs on the server. The phone records, takes the tap and uploads                                                                         |
| D6                       | The partner's pose stays in memory only and is never stored                                                                                        |
| D7                       | Production training uses opt-in labels only                                                                                                        |
| D8                       | v0 timeline from Gemini via the Vertex EU endpoint, then CV v1                                                                                     |
| D9, A1                   | Hono TypeScript API + Python GPU workers. The job queue is **pg-boss** (A1, Henry, 2026-10-17)                                                     |
| D10                      | Uploads: tus (`react-native-tus`) → tusd → S3 multipart on Hetzner Object Storage                                                                  |
| D11                      | Hetzner Cloud in Germany + Coolify; Postgres with row-level security                                                                               |
| D12, HEN-227             | GPU on Modal `eu`. HEN-227 (M3-12) sets the EU residency rules: job ID + object key payloads, no `.spawn()`, short-lived presigned URLs            |
| D14                      | Deletion cascades to storage, derived tracks and the training manifest (SillyRabbit `cascadeDelete.ts` pattern)                                    |
| D15                      | No face or body re-identification across videos                                                                                                    |
| D17, D18, D19, D25       | Better Auth: email OTP, magic link, Apple, Google; no passwords; emails field-encrypted (AES-256-GCM + HMAC); account: email, handle, provider ids |
| Planning D22             | Every person other than the tapped user is masked in all rendered or shared output and in clips sent to the LLM                                    |
| Repo D24                 | The owner can see their own footage unmasked (Henry, 2026-10-17). See the numbering note below                                                     |
| A2, A3                   | Testcontainers with `postgres:18.6`; Ruff + pytest for `packages/workers`                                                                          |
| H5                       | 16+ minimum age; optional 18+ for purchases (HEN-263)                                                                                              |
| H9                       | Gi and no-gi at equal weight, so every video carries `style: "gi" \| "no-gi"`                                                                      |
| HEN-44 label set         | Level 1: 18 positions and 9 events, with level 2 as a pick list (Henry, 2026-10-17)                                                                |
| M6-14 baseline (HEN-197) | Sara's baseline is no E2E in v1: server-side per-object encryption, no operator read path, audit log. Henry decides in HEN-201                     |
| Plan change 2026-10-18   | Both stores; one-time Pro purchase; paid human review with public ratings; free gym-mate review with text and voice notes; no card data held       |

**Numbering note:** the repo's `DECISIONS.md` entry "owner can see their own footage unmasked" was D22, which collided with planning D22 (masking).
Sara's call on 2026-10-18 was to move the repo entry to the next free D number and keep planning D22 as masking. Done in HEN-70 (2026-10-22): the repo
entry is now D24.

## 1. Module layout

Packages live in `packages/*`, scoped `@bjj-roll/<name>`, linked with `workspace:*`. Flat feature files, as in SillyRabbit.

| Package              | State today                                        | Contents (target)                                                                                                                                                                                                                                  |
| -------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@bjj-roll/shared`   | `formatGreeting` placeholder                       | `src/schemas/*.ts` with the Zod schemas in §2 (single source of truth for API, job and DB types); `src/encryption/` for the D18 module (HEN-63); no runtime dependencies other than Zod                                                            |
| `@bjj-roll/backend`  | Hono app with `/health`, Testcontainers round trip | `app.ts`, `server.ts`, `*Routes.ts` (videos, grants, notes, reviews, consent, internal job routes), `jobRunner.ts` (the pg-boss process, §3), `cascadeDelete.ts` + tests (§5), `signedUrls.ts`, `database/` (migrations, RLS policies, role setup) |
| `@bjj-roll/mobile`   | Expo SDK 57 hello world (react-native 0.86.3)      | Record (VisionCamera), tus upload, tap, timeline, notes, consent screens. UI kit per §8                                                                                                                                                            |
| `@bjj-roll/frontend` | Not created yet (HEN-46)                           | Web review UI (Vite, built separately in CI, outside root `tsc -b`). When it ships is A8 (OPEN, Sara/Henry)                                                                                                                                        |
| `packages/workers`   | Open in PR #12 (HEN-56): Python 3.15.0, uv, Ruff   | Python package `bjj_roll_workers`: the Modal functions (tracking, pose, classifier, masked render). Inputs and outputs follow the JSON Schema generated from the `shared` job schemas (§3.6). Never reads or writes the pg-boss tables             |

Data flow for video processing (the Gemini call through Vertex EU is not drawn; where it runs is open, §3.2):

```text
mobile ──tus──▶ tusd ──S3 multipart──▶ Hetzner Object Storage (videos/{videoId}/...)
   │                                         ▲            │
   └──HTTPS (Better Auth session)──▶ backend (Hono) ── presigned GET/PUT URLs, short TTL
                                        │   ▲
                         pg-boss send() │   │ complete() / fail()
                                        ▼   │
                              Postgres (app schema + pgboss schema)
                                        │
                            jobRunner (Node, pg-boss work())
                                        │ Modal JS SDK, .remote(jobId, objectKey), routing region eu-west
                                        ▼
                         Modal `eu` function (packages/workers, Python)
                                        └── calls backend internal job routes for job parameters and presigned URLs
```

## 2. Shared Zod types

The sketches below are for review only. They go into `packages/shared/src/schemas/` once HEN-46 adds `zod` as a dependency (Zod 4 syntax, subject to the
14-day `minimumReleaseAge`). Ids are UUIDs (`gen_random_uuid()`), timestamps are ISO 8601 with offset, and every video position is in whole milliseconds
from the start of the video.

### 2.1 Common building blocks

```ts
import { z } from "zod";

export const identifierSchema = z.uuid();
export const timestampSchema = z.iso.datetime({ offset: true });
export const videoTimestampMillisecondsSchema = z.int().min(0);

// H9: every video is gi or no-gi.
export const styleSchema = z.enum(["gi", "no-gi"]);

// Only "private" is live until M6 (group) and M7 (gym). See §4.
export const visibilitySchema = z.enum(["private", "group", "gym"]);

// HEN-44 label set v1: level 1 ids (Henry approved the level 1 size, 2026-10-17). Level 2 details are a pick list per label.
export const positionLabelSchema = z.enum([
  "standing",
  "clinch",
  "closed_guard",
  "half_guard",
  "open_guard",
  "headquarters",
  "side_control",
  "north_south",
  "knee_on_belly",
  "mount",
  "back_control",
  "turtle",
  "front_headlock",
  "crucifix",
  "truck",
  "leg_entanglement",
  "scramble",
  "unknown",
]);
export const eventLabelSchema = z.enum(["takedown", "guard_pull", "guard_pass", "sweep", "back_take", "submission", "escape", "transition", "reset"]);
export const roleSchema = z.enum(["top", "bottom", "neutral"]);
```

Labels marked [Gi] in HEN-44 are hidden for `no-gi` videos. A `submission` event also carries an outcome: `attempt`, `defended` or `finish`.

### 2.2 Core entities (user, video, timeline, correction)

```ts
export const userSchema = z.object({
  id: identifierSchema,
  handle: z.string().min(3).max(30), // D19. Length limits: OPEN (Henry)
  createdAt: timestampSchema,
}); // The email never leaves the backend: email_ciphertext and email_hash are DB columns only (D18).

export const videoProcessingStatusSchema = z.enum(["uploading", "queued", "processing", "needs_user", "ready", "failed"]);

export const videoSchema = z.object({
  id: identifierSchema,
  ownerId: identifierSchema,
  style: styleSchema,
  visibility: visibilitySchema.default("private"),
  processingStatus: videoProcessingStatusSchema,
  durationMilliseconds: z.int().positive().optional(),
  sharesRestrictedAt: timestampSchema.nullable(), // set by a "minor visible" report (M6-17, HEN-200)
  createdAt: timestampSchema,
});

export const timelineSegmentSchema = z.object({
  id: identifierSchema,
  videoId: identifierSchema,
  startMilliseconds: videoTimestampMillisecondsSchema,
  endMilliseconds: videoTimestampMillisecondsSchema,
  position: positionLabelSchema,
  role: roleSchema,
  confidence: z.enum(["high", "medium", "low"]), // semantic categories, not raw percentages (Lydia's UI research)
  source: z.enum(["gemini_v0", "computer_vision_v1", "user_correction"]),
});

export const correctionSchema = z.object({
  id: identifierSchema,
  videoId: identifierSchema,
  userId: identifierSchema,
  startMilliseconds: videoTimestampMillisecondsSchema,
  endMilliseconds: videoTimestampMillisecondsSchema,
  label: positionLabelSchema, // PLAN M4 task 7: (video_id, t0, t1, label, user_id)
  levelTwoDetail: z.string().optional(), // HEN-44 level 2 pick list id
  createdAt: timestampSchema,
});
```

### 2.3 Access grant

```ts
export const accessGrantKindSchema = z.enum(["gym_mate", "reviewer"]);
export const accessGrantScopeSchema = z.enum(["view", "note"]); // "note" includes "view"

export const accessGrantRevocationReasonSchema = z.enum([
  "owner_revoked",
  "user_blocked", // M6-16, HEN-199
  "review_delivered", // M10-10, HEN-212
  "account_deleted",
]);

export const accessGrantSchema = z.object({
  id: identifierSchema,
  videoId: identifierSchema,
  ownerId: identifierSchema,
  granteeId: identifierSchema,
  kind: accessGrantKindSchema,
  scope: accessGrantScopeSchema,
  reviewRequestId: identifierSchema.nullable(), // set for kind "reviewer"
  createdAt: timestampSchema,
  expiresAt: timestampSchema.nullable(), // null only if Henry decides gym-mate shares last until revoked (HEN-192)
  revokedAt: timestampSchema.nullable(),
  revocationReason: accessGrantRevocationReasonSchema.nullable(),
});
```

### 2.4 Consent record

One table for every attestation and consent. No free text is stored: the wording is identified by `textVersionId`, which points to a versioned,
lawyer-reviewed text (M4-24, HEN-189).

```ts
export const consentRecipientTypeSchema = z.enum(["ai_vendor", "gym_mate", "reviewer"]);

const consentRecordBaseSchema = z.object({
  id: identifierSchema,
  userId: identifierSchema,
  textVersionId: z.string().min(1),
  acceptedAt: timestampSchema,
  withdrawnAt: timestampSchema.nullable(),
});

export const consentRecordSchema = z.discriminatedUnion("consentType", [
  consentRecordBaseSchema.extend({ consentType: z.literal("attestation_signup") }), // M2-13, HEN-183 (built: migration 005)
  consentRecordBaseSchema.extend({ consentType: z.literal("attestation_upload"), videoId: identifierSchema }), // M4-25, HEN-190
  consentRecordBaseSchema.extend({ consentType: z.literal("attestation_share"), videoId: identifierSchema }), // M6-11 (type name proposed)
  consentRecordBaseSchema.extend({ consentType: z.literal("attestation_review_request"), videoId: identifierSchema }), // M10-09 (type name proposed)
  consentRecordBaseSchema.extend({
    consentType: z.literal("consent_third_party"), // Apple 5.1.2(i): before footage goes to the AI vendor, a gym mate or a reviewer
    videoId: identifierSchema,
    recipientType: consentRecipientTypeSchema,
    recipientUserId: identifierSchema.nullable(), // null for "ai_vendor"
  }),
  consentRecordBaseSchema.extend({ consentType: z.literal("consent_training_opt_in") }), // D7, M8-02 (type name proposed)
  consentRecordBaseSchema.extend({ consentType: z.literal("consent_person_in_video"), videoId: identifierSchema }), // HEN-69 (type name proposed)
]);
```

`attestation_signup` (HEN-183), `attestation_upload` and `consent_third_party` are the names recorded in Linear. The other type names are proposals.

### 2.5 Notes (text and voice)

```ts
const noteBaseSchema = z.object({
  id: identifierSchema,
  videoId: identifierSchema,
  authorId: identifierSchema,
  videoTimestampMilliseconds: videoTimestampMillisecondsSchema, // where on the video the note is pinned
  accessGrantId: identifierSchema.nullable(), // null when the owner writes on their own video
  reviewId: identifierSchema.nullable(), // set when the note is part of a paid review breakdown
  positionLabel: positionLabelSchema.optional(), // M10-10: optional HEN-44 tag
  eventLabel: eventLabelSchema.optional(),
  createdAt: timestampSchema,
});

export const noteSchema = z.discriminatedUnion("kind", [
  noteBaseSchema.extend({
    kind: z.literal("text"),
    text: z.string().min(1).max(2000), // max length: OPEN (Henry); 2000 is a placeholder
  }),
  noteBaseSchema.extend({
    kind: z.literal("voice"),
    audioObjectKey: z.string().regex(/^videos\/[0-9a-f-]{36}\/voice-notes\/[0-9a-f-]{36}\.m4a$/),
    durationMilliseconds: z.int().positive().max(60_000), // length cap from M6-12 (HEN-195): value OPEN (Henry); 60 s is a placeholder
  }),
]);
```

### 2.6 Review request, offer, review, rating

What an "offer" is has not been written down anywhere. The sketch reads it as a reviewer's answer to a request (needed for random requests, where several
reviewers might answer). That reading is **OPEN (Henry, with HEN-203 and HEN-211)**.

```ts
export const reviewRequestSchema = z.object({
  id: identifierSchema,
  requesterId: identifierSchema,
  videoId: identifierSchema,
  mode: z.enum(["direct", "random"]), // M10-09
  reviewerId: identifierSchema.nullable(), // required for "direct"; set on acceptance for "random"
  style: styleSchema, // copied from the video, used for random matching
  status: z.enum(["pending", "accepted", "declined", "expired", "cancelled", "delivered"]),
  consentRecordId: identifierSchema, // the consent_third_party record (recipient type "reviewer")
  createdAt: timestampSchema,
  expiresAt: timestampSchema, // request expiry length: OPEN (Henry)
});

export const reviewOfferSchema = z.object({
  id: identifierSchema,
  reviewRequestId: identifierSchema,
  reviewerId: identifierSchema,
  status: z.enum(["open", "accepted", "declined", "withdrawn", "expired"]),
  storePriceTierId: z.string().nullable(), // store price tier (M10-02). Who sets the price: OPEN (Henry, HEN-203)
  createdAt: timestampSchema,
  expiresAt: timestampSchema,
});

export const reviewSchema = z.object({
  id: identifierSchema,
  reviewRequestId: identifierSchema,
  reviewerId: identifierSchema,
  summary: z.string().max(5000), // max length: OPEN (Henry)
  status: z.enum(["draft", "submitted"]), // submit locks the review (M10-10)
  submittedAt: timestampSchema.nullable(),
});

export const ratingSchema = z.object({
  id: identifierSchema,
  reviewId: identifierSchema, // one rating per delivered review (M10-13)
  raterId: identifierSchema, // must be the requester of that review
  reviewerId: identifierSchema,
  reviewerScore: z.int().min(1).max(5), // scale: OPEN (Henry, HEN-207); 1–5 is a placeholder
  breakdownScore: z.int().min(1).max(5), // same
  comment: z.string().max(1000).nullable(), // whether public ratings carry text at all: OPEN (Henry, HEN-207)
  createdAt: timestampSchema,
});
```

## 3. Hono ↔ worker job contract (pg-boss)

### 3.1 Who claims jobs (decided: option A, Sara, 2026-10-22)

A1 records a known risk: Python workers claiming pg-boss jobs over SQL is untested. In pg-boss 12.38.0 (the current release, read for this doc) the fetch SQL is built per
queue policy and partition, with group concurrency, heartbeats and dead-letter lineage. Copying that in Python would tie the workers to pg-boss internals.

- **Option A (decided):** only Node touches pg-boss. A `jobRunner` process in `packages/backend` claims jobs with `work()` and calls the Modal function
  synchronously with `.remote(jobId, objectKey)` through the Modal JavaScript SDK (`modal` on npm, 0.11.1, which lists "call a deployed Function" and
  "override its routing region" examples). This matches HEN-227: no `.spawn()`, async handling in pg-boss, payload only a job ID and an object key. Python
  stays inside Modal functions. **Required spike:** the JS SDK call to an `eu` function with `routing_region="eu-west"` is not tested yet. Test it in HEN-48 before building on it.
- **Option B (rejected):** a Python dispatcher claims jobs from `pgboss.job` with its own `FOR UPDATE SKIP LOCKED` query. This is the path A1 flags as risky, and it
  breaks whenever pg-boss changes its schema.

Sara chose option A on 2026-10-22. The rest of §3 is written for option A.

### 3.2 Queues [Proposal]

| Queue                   | Work                                                    | Runs on                                                                               | Issue          |
| ----------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------- |
| `video_transcode`       | ffmpeg to 720p                                          | OPEN: decided by the HEN-87 spike (measure cost and runtime, Hetzner VM vs Modal CPU) | HEN-87         |
| `video_timeline_gemini` | v0 timeline through Vertex EU                           | backend (Node, Vertex EU), decided (Sara, 2026-10-22)                                 | HEN-66         |
| `video_track`           | Tap → SAM 2.1 tracking of the user                      | Modal `eu`                                                                            | HEN-67         |
| `video_classify`        | Pose + two-person classifier (partner pose memory-only) | Modal `eu`                                                                            | HEN-73, HEN-79 |
| `video_render_masked`   | Whole-body masked share render (planning D22)           | Modal `eu`                                                                            | HEN-81         |
| `video_delete`          | Cascade delete orchestration (§5)                       | backend                                                                               | HEN-95         |

Each queue has a dead-letter queue named `<queue>_dead_letter`.

### 3.3 States and claim

pg-boss job states (from the 12.38.0 schema; the same six in 12.37.1, the version the repo pins): `created`, `retry`, `active`, `completed`, `cancelled`, `failed`.

| pg-boss state | Meaning here                                      | `videos.processing_status` shown in the app    |
| ------------- | ------------------------------------------------- | ---------------------------------------------- |
| `created`     | Sent, waiting for a runner slot                   | `queued`                                       |
| `active`      | Claimed by the runner; Modal call in progress     | `processing`                                   |
| `retry`       | Attempt failed, waiting for the next one          | `processing`                                   |
| `completed`   | Result validated and stored                       | `ready` (or `needs_user` for "Is this you?")   |
| `failed`      | All retries used; copied to the dead-letter queue | `failed`, with an error class the app explains |
| `cancelled`   | Video deleted, or the owner cancelled             | (row deleted with the video)                   |

- Claim: `work()` with batch size 1 (pg-boss claims with `FOR UPDATE SKIP LOCKED`). `localConcurrency` per queue caps parallel Modal calls, which caps GPU
  spend against the EUR 50–100/month testing cap (H3).
- `singletonKey = "<videoId>:<queue>"`, so one video never has two live jobs of the same kind.
- The app keeps its own `video_jobs (video_id, queue, job_id)` table, so the cascade can find and cancel jobs without reading `pgboss.job.data`.

### 3.4 Retries, expiry and dead letter (accepted as starting values, Sara, 2026-10-22; tune in M3)

- Retries: pg-boss default `retryLimit: 2`, with `retryBackoff: true` and `retryDelay: 30` seconds. Modal-side retries are off, so pg-boss is the only
  retry authority.
- Expiry: `expireInSeconds` per queue, set from the measured runtime in M3 (pg-boss default is 900 s). An expired job counts as a failed attempt.
- Not retried: payload or result validation errors, and a missing video (deleted meanwhile). The runner fails these with `retryLimit` exhausted.
- Dead letter: after the last attempt, pg-boss copies the payload to `<queue>_dead_letter`. Nothing consumes it automatically; it is for inspection and a
  manual redrive. Dead-letter rows hold only ids (§3.5) and follow the same retention as the video (§5).
- Idempotency: the worker writes outputs under `videos/{videoId}/jobs/{jobId}/...` and the result is stored in one transaction keyed by `jobId`, so a
  repeated attempt overwrites instead of duplicating.

### 3.5 Payload and result schemas

```ts
export const jobQueueSchema = z.enum([
  "video_transcode",
  "video_timeline_gemini",
  "video_track",
  "video_classify",
  "video_render_masked",
  "video_delete",
]);

// Stored in pgboss.job.data. Ids only: no email, no filename, no URL, no bytes (HEN-227).
export const jobPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  queue: jobQueueSchema,
  videoId: identifierSchema,
  inputObjectKey: z.string().regex(/^videos\/[0-9a-f-]{36}\//),
});

// The only arguments the Modal function receives.
export const modalCallInputSchema = z.object({
  jobId: identifierSchema,
  inputObjectKey: jobPayloadSchema.shape.inputObjectKey,
});

// Fetched by the worker from GET /internal/jobs/{jobId} while the job is active.
export const jobParametersSchema = z.object({
  jobId: identifierSchema,
  queue: jobQueueSchema,
  style: styleSchema,
  tapPoint: z.object({ frameIndex: z.int().min(0), x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(), // video_track only
});

export const jobErrorClassSchema = z.enum(["input_unreadable", "tracking_lost", "vendor_unavailable", "timeout", "internal"]);

// Returned by .remote(). Must stay under 2 MiB to stay in Modal's EU routing region (HEN-227).
export const jobResultSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("succeeded"),
    jobId: identifierSchema,
    outputObjectKeys: z.array(z.string()).max(20),
    timelineSegments: z.array(timelineSegmentSchema.omit({ id: true })).optional(),
    needsUserConfirmation: z.boolean(), // "Was this you?" re-prompt (HEN-72)
  }),
  z.object({ outcome: z.literal("failed"), jobId: identifierSchema, errorClass: jobErrorClassSchema, retryable: z.boolean() }),
]);
```

### 3.6 Worker side

- Internal routes (backend, not public): `GET /internal/jobs/{jobId}` (parameters) and `POST /internal/jobs/{jobId}/object-urls` (presigned GET for the
  input, presigned PUT for declared outputs). Both answer only while the job is `active`. Worker URLs live 15 minutes (decided, Sara, 2026-10-22).
- The worker authenticates with a service token that can only call these two routes. It lives in Modal Secrets, which Modal keeps in the US. Accepted
  (Sara, 2026-10-22): the token's scope is limited to the two internal routes and it is not user data. It is rotated on every deploy, or at least every 90
  days. Modal's US-held metadata is already on the lawyer list.
- The Python side validates against JSON Schema generated from these Zod schemas (Zod 4 `z.toJSONSchema`) and committed to `packages/workers`. A test in
  `shared` fails if the committed JSON Schema is stale.
- Logs: job id, queue, timings and error class only (HEN-227 log-scrub test). Partner pose, masks and metrics are never persisted (D6).

### 3.7 Email queue (HEN-284)

Sign-in codes, magic links and the account-deleted notice go through the pg-boss queue `email_send` (`packages/backend/src/email/emailQueue.ts`, pg-boss
12.37.1, pinned; Sara, 2026-10-27: stay on it). The API process runs the worker; pg-boss creates its own `pgboss` schema on start, so the app role
needs CREATE on the database (without it the server stops with a message naming the GRANT). Account-deletion codes are sent directly, not queued
(Sara, 2026-10-27), because DELETE /account waits for them.

- Retries: 3 tries in all (`retryLimit: 2`), first retry after 1 s, doubling, at most 60 s. A 4xx answer (except 408, 409, 429) or a configuration error
  is not retried. A try still running after 60 s counts as failed (the provider timeout is 10 s).
- Duplicates: the job id is derived from a keyed hash of the email (or a caller key, such as the user id for the deleted notice), so the same request twice
  stores one job. The job id is sent to Lettermint as `Idempotency-Key`, so a retry after a slow or timed-out send does not send a second email.
- No dead-letter queue (Sara, 2026-10-27): after the last try, or at once for a non-retried error, the worker writes one JSON line
  `email_dead_lettered` to stdout with only the job id, the template, an error class and `attempts` (tries made, pg-boss `retryCount + 1`; never the
  address, code, link or provider text), then deletes the job. A payload the worker cannot decrypt is logged the same way at once, with template
  `unknown`. There is no `_dead_letter` queue for emails, so the payload is not kept.
- Privacy: the job row holds only what the send needs (address, and the code or link), sealed with the app data key (D18). The row is deleted as soon as
  the email is sent or finally fails. Unsent, a code or link job is dropped when the code or link expires; the deleted notice job, which has none, after
  at most 6 hours (`EMAIL_QUEUE_NOTICE_LIFETIME_SECONDS`), so it outlives the account by at most that.

## 4. Row-level security

### 4.1 Roles and session context [Proposal, following SEC-08 in HEN-58]

- `bjj_owner` owns the tables and runs migrations. `bjj_app` is the API role: not the owner, no `BYPASSRLS`, and `FORCE ROW LEVEL SECURITY` on every
  user-data table. `bjj_job_runner` is the runner role, with grants only on the columns and tables it needs.
- Each API request runs in a transaction that starts with `SET LOCAL app.user_id = '<session user id>'`. The helper `app_current_user_id()` reads
  `NULLIF(current_setting('app.user_id', true), '')` and returns null when it is unset, so a missing context returns no rows.

| Role                | Login                          | `BYPASSRLS`        | Purpose, policies and functions                                                                                                                                                                                                                                                                                                                                      |
| ------------------- | ------------------------------ | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bjj_owner`         | `NOLOGIN`                      | No (`NOBYPASSRLS`) | Owns the tables and runs migrations; bound by `FORCE ROW LEVEL SECURITY` on every user-data table.                                                                                                                                                                                                                                                                   |
| `bjj_app`           | App pool / `SET LOCAL ROLE`    | No (`NOBYPASSRLS`) | API role: not the table owner; accesses user-data tables through owner RLS policies (`app_current_user_id()`); granted `EXECUTE` on `app_user_id_by_email_hmac(email_hmac)`.                                                                                                                                                                                         |
| `bjj_job_runner`    | Runner pool / `SET LOCAL ROLE` | No (`NOBYPASSRLS`) | Worker runner role, with grants only on the columns and tables it needs.                                                                                                                                                                                                                                                                                             |
| `bjj_policy_helper` | `NOLOGIN`                      | No (`NOBYPASSRLS`) | Owns leaf `SECURITY DEFINER` RLS helper functions on shared video and grant tables so policies do not loop under `FORCE ROW LEVEL SECURITY`.                                                                                                                                                                                                                         |
| `bjj_auth_lookup`   | `NOLOGIN`                      | No (`NOBYPASSRLS`) | Pre-session user lookup by email HMAC only: `SELECT` on `users` (no `INSERT`, `UPDATE` or `DELETE` on any table), one RLS policy `users_auth_lookup_select` (`FOR SELECT TO bjj_auth_lookup`), and owns the `SECURITY DEFINER` function `app_user_id_by_email_hmac(email_hmac)` (pinned `search_path`, returns `user_id` only, `EXECUTE` granted to `bjj_app` only). |

### 4.2 Owner-only (v1, live from M2)

```sql
CREATE POLICY videos_owner_all ON videos
  USING (owner_id = app_current_user_id())
  WITH CHECK (owner_id = app_current_user_id());
```

The same owner policy applies to every table with an `owner_id` or `user_id` (timeline segments, corrections, consent records, notes on own videos, push
tokens). The owner may get a URL to their unmasked source video (repo D24). Everyone else only ever gets the masked render (planning D22).

### 4.3 Later visibility levels

`videos.visibility` is `private` (default) → `group` (M6, HEN-68) → `gym` (M7, HEN-83), as in the TECH §7 roles model. Until those milestones, a check
constraint keeps the column at `private`. The later policies are additive:

```sql
-- M6 (HEN-68): members of a group the video is shared to
CREATE POLICY videos_group_read ON videos FOR SELECT
  USING (visibility = 'group' AND shares_restricted_at IS NULL AND EXISTS (
    SELECT 1 FROM video_group_shares share JOIN group_members member ON member.group_id = share.group_id
    WHERE share.video_id = videos.id AND member.user_id = app_current_user_id() AND member.removed_at IS NULL));
-- M7 (HEN-83): same shape with gym_members and the gym tenant
```

Object keys live in their own table, `video_objects (video_id, kind, object_key)`, with `kind` one of `source`, `transcode`, `render_masked`, `thumbnail`.
RLS on `videos` can only filter rows, not columns, so this split is what keeps the source key away from everyone but the owner: group, gym and grant
policies on `video_objects` only ever match `kind = 'render_masked'`.

### 4.4 Reviewer and gym-mate access grants (HEN-193, M6-10)

One grant table serves gym-mate review (HEN-194) and paid review (HEN-211). The columns follow §2.3, with these constraints:

- `grantee_id <> owner_id`; `expires_at > created_at`; `kind = 'reviewer'` requires `expires_at IS NOT NULL` and a `review_request_id`.
- No grant can be created while either user blocks the other (M6-16) or while `videos.shares_restricted_at` is set (M6-17).
- A grant can only be created after the matching `consent_third_party` record exists (recipient type `gym_mate` or `reviewer`).

```sql
CREATE FUNCTION app_has_active_grant(target_video_id uuid, required_scope text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app AS $$
  SELECT EXISTS (
    SELECT 1 FROM access_grants grant_row JOIN videos video ON video.id = grant_row.video_id
    WHERE grant_row.video_id = target_video_id
      AND grant_row.grantee_id = app_current_user_id()
      AND grant_row.revoked_at IS NULL
      AND (grant_row.expires_at IS NULL OR grant_row.expires_at > now())
      AND (required_scope = 'view' OR grant_row.scope = 'note')
      AND video.shares_restricted_at IS NULL);
$$;

CREATE POLICY videos_grantee_read ON videos FOR SELECT USING (app_has_active_grant(id, 'view'));
CREATE POLICY video_objects_grantee_read ON video_objects FOR SELECT
  USING (kind = 'render_masked' AND app_has_active_grant(video_id, 'view'));
CREATE POLICY notes_grantee_insert ON notes FOR INSERT
  WITH CHECK (author_id = app_current_user_id() AND app_has_active_grant(video_id, 'note'));
CREATE POLICY notes_grantee_read_own ON notes FOR SELECT USING (author_id = app_current_user_id() AND app_has_active_grant(video_id, 'view'));
```

`FORCE ROW LEVEL SECURITY` also binds the table owner, so a `SECURITY DEFINER` helper owned by `bjj_owner` would hit the `videos` policies again and
recurse. The helper functions are therefore owned by a separate role, `bjj_policy_helper`, which has `BYPASSRLS`, owns nothing else and cannot log in.
HEN-193 tests this together with the catalogue check from HEN-58.

The video owner reads every note on their video through the owner policy. Whether grantees see each other's notes is **OPEN (Henry)**; the sketch shows
only their own.

**Signed URLs (TTLs decided, Sara, 2026-10-22):** media is served only as presigned GET URLs to the masked render, issued by the API after the RLS check passes. The TTL is **300
seconds**, or the time left on the grant if that is shorter. The app asks for a new URL when one expires. A single 720p MP4 with range requests means one
URL per playback. Revocation cannot reach a URL that was already issued, so media access ends within the TTL; database access ends on the next request.

**Revoke and expiry behaviour:**

| Event                                   | Effect                                                                                                          |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Owner revokes                           | `revoked_at = now()`, reason `owner_revoked`. Next API call: 403. URLs already issued stop working within 300 s |
| `expires_at` passes                     | No job needed: the policy compares against `now()`. Next call: 403                                              |
| Block between owner and grantee (M6-16) | All grants between them revoked, reason `user_blocked`                                                          |
| "Minor visible" report (M6-17)          | `videos.shares_restricted_at` set; every grant on the video stops at once without changing grant rows           |
| Review submitted (M10-10)               | Reviewer grant revoked, reason `review_delivered`                                                               |
| Video deleted                           | Grant rows, render and notes deleted by the cascade (§5); URLs return 404 once the object is gone               |
| Grantee or owner deletes their account  | Grants revoked (`account_deleted`), then removed with the cascade                                               |

- API answers: a grant that existed but expired or was revoked gives **403**; an id the caller never had access to gives **404**, so ids cannot be probed.
  Video ids are random UUIDs.
- Audit: grant created, revoked and expired-access-denied events go to an audit log with ids and timestamps only, no content (HEN-193).
- What happens to a grantee's notes after revoke or expiry (stay visible to the owner, or go) is **OPEN (Henry)**.

### 4.5 Gym-mate sharing mapped to visibility levels

| Henry's feature                           | Mechanism                                                                                                                         |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Send a roll to chosen gym mates (HEN-194) | One access grant per gym mate (`kind = 'gym_mate'`). The video stays `private`; grants add readers, they do not change visibility |
| Who may be picked as a gym mate           | Members of a group the owner belongs to (M6 `group`), or of the same gym tenant (M7 `gym`): depends on HEN-192                    |
| Standing access for a whole group or gym  | `visibility = 'group'` or `'gym'` with the policies in §4.3 (team libraries, the M7 fight library)                                |
| Paid reviewer (HEN-211)                   | Access grant with `kind = 'reviewer'`, always time-boxed                                                                          |

Open points, all in **HEN-192 (M6-09, Henry + lawyer)**:

1. Do reviewers and gym mates see the partner masked (planning D22 as it stands), or unmasked only with the partner's recorded per-video consent (HEN-69)?
2. Is "gym" for free review an informal group the user picks (M6) or an official gym tenant with an admin (M7)?
3. Can any belt review inside a gym, or only some belts?
4. Do gym-mate shares expire, and after how long, or do they last until revoked? (`expires_at` is nullable only for this case.)

Until HEN-192 is answered, every share path renders masked output (Lydia's recommendation, recorded in HEN-192).

## 5. Cascade-delete map (D14)

Triggers: **V** = the owner deletes a video. **A** = a user deletes their account (HEN-65). All V rows also run for every video of a deleted account.
Account deletion needs a fresh emailed code: `POST /account/delete-code`, then `DELETE /account` with `{ code }` (Better Auth email-OTP, shared per-email limits). It deletes at once with no grace period or undo. A notice goes to the address read before the cascade; if that send fails, the delete still stands and only a PII-free log line is written.
Deletion is one orchestrated `video_delete` job (HEN-95) built on the SillyRabbit `cascadeDelete.ts` pattern, with a test per entity (standing criterion 6).

| Entity                                                                      | Store                         | V                                         | A                                         | Retention conflict                                                                                                                                              |
| --------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User row (handle, `email_ciphertext`, `email_hash`)                         | Postgres                      | –                                         | delete                                    | –                                                                                                                                                               |
| Sessions, OTP codes                                                         | Postgres                      | –                                         | delete                                    | –                                                                                                                                                               |
| Provider accounts (`accounts`: provider id, `sub`, encrypted Apple token)   | Postgres                      | –                                         | revoke Apple token, then delete           | – (D19, HEN-239: a failed Apple revoke is logged with the user id only; the delete still goes through)                                                          |
| Per-email OTP send counter (`rate_limits`, hash-only key)                   | Postgres                      | –                                         | keep until its 15-min window ends         | – (Sara, 25 Oct, HEN-65: deleting it would let delete + re-signup bypass the send limit)                                                                        |
| Video row, tap point                                                        | Postgres                      | delete                                    | delete                                    | –                                                                                                                                                               |
| Source video, transcode, masked renders, thumbnails                         | Object storage `videos/{id}/` | delete                                    | delete                                    | –                                                                                                                                                               |
| User's own tracks, masks, keypoints (partner's never stored, D6)            | Object storage / Postgres     | delete                                    | delete                                    | –                                                                                                                                                               |
| Timeline segments, corrections                                              | Postgres                      | delete                                    | delete                                    | –                                                                                                                                                               |
| Per-user priors and patterns (HEN-102)                                      | Postgres                      | recompute                                 | delete                                    | –                                                                                                                                                               |
| Jobs (`video_jobs`, pg-boss rows incl. dead letter)                         | Postgres                      | cancel + delete                           | cancel + delete                           | –                                                                                                                                                               |
| Modal copies (ephemeral disk; inputs/outputs kept up to 7 days; 1-day logs) | Modal                         | expire                                    | expire                                    | Vendor-side retention after deletion: confirm with the Modal DPA read (HEN-39)                                                                                  |
| Gemini / Vertex EU clips                                                    | Google                        | vendor terms                              | vendor terms                              | Vertex retention: not checked. Confirm in the DPA read                                                                                                          |
| Training manifest entries (opt-in, D7)                                      | Postgres / training store     | delete                                    | delete                                    | **OPEN FOR LAWYER:** models already trained on the data (unlearning, TECH hard unknown 6, HEN-53)                                                               |
| Access grants (given and received)                                          | Postgres                      | delete                                    | revoke, then delete                       | –                                                                                                                                                               |
| Text notes (on own videos, and written on others' videos)                   | Postgres                      | delete all notes on the video             | delete notes the user wrote               | –                                                                                                                                                               |
| Voice notes (rows + audio objects)                                          | Postgres + object storage     | delete                                    | delete notes the user recorded            | –                                                                                                                                                               |
| Review requests, offers                                                     | Postgres                      | delete                                    | delete                                    | Link to payment records: see below                                                                                                                              |
| Reviews (breakdowns)                                                        | Postgres                      | delete                                    | requester: delete; reviewer: OPEN         | **OPEN (Henry + lawyer):** does a requester keep a paid review after the reviewer deletes their account?                                                        |
| Ratings (public)                                                            | Postgres                      | delete with the review                    | OPEN                                      | **OPEN FOR LAWYER + Henry (HEN-207):** delete or anonymise a public rating when its author or the rated reviewer leaves                                         |
| Consent and attestation records                                             | Postgres                      | delete, unless the lawyer says keep proof | delete, unless the lawyer says keep proof | **OPEN FOR LAWYER:** keep minimal proof of consent or attestation after deletion (Art. 7(1) GDPR, M2-13 note), and for how long                                 |
| Payment records (store or provider references only)                         | Postgres                      | OPEN FOR LAWYER                           | OPEN FOR LAWYER                           | **OPEN FOR LAWYER:** commercial and tax retention (Lydia: about 6–10 years [unverified]); which fields, and who keeps them under seller option A or B (HEN-208) |
| Payout records (provider references, DAC7 fields)                           | Postgres                      | OPEN FOR LAWYER                           | OPEN FOR LAWYER                           | **OPEN FOR LAWYER:** DAC7 reporting data and tax retention (HEN-214)                                                                                            |
| Reports, moderation action log, statements of reasons                       | Postgres                      | delete reported content                   | OPEN                                      | **OPEN FOR LAWYER:** DSA action-log retention (HEN-198); dispute evidence (HEN-216)                                                                             |
| Blocks                                                                      | Postgres                      | –                                         | delete                                    | –                                                                                                                                                               |
| Audit log (ids only)                                                        | Postgres                      | OPEN FOR LAWYER                           | OPEN FOR LAWYER                           | **OPEN FOR LAWYER:** how long security audit entries may be kept after deletion                                                                                 |
| Group and gym memberships (M6, M7)                                          | Postgres                      | –                                         | delete                                    | Gym-side copies are the gym's (Art. 26 / 28 arrangement, M7): OPEN FOR LAWYER                                                                                   |
| Push tokens (HEN-196)                                                       | Postgres                      | –                                         | delete                                    | –                                                                                                                                                               |
| Backups                                                                     | Backup store                  | ages out                                  | ages out                                  | **OPEN FOR LAWYER + HEN-50:** deleted data stays in backups until rotation. Backup window: OPEN (owned by HEN-50)                                               |
| Logs                                                                        | Hetzner, Modal                | ages out                                  | ages out                                  | No personal data in logs (A5, HEN-227)                                                                                                                          |

Rules that are not open:

- Shared copies die with the video: grants, renders and notes go in the same job (HEN-101).
- Until the lawyer answers, nothing in an **OPEN FOR LAWYER** row is decided. If the answer is to keep something, the kept row should hold only the fields
  the legal reason needs and be unlinked from the video and the handle where possible [Proposal].

Play web deletion-request URL and owner: OPEN (Henry). TODO: ticket to be created (related: the HEN-185 web-URL deletion criterion, HEN-65).

## 6. Encryption inventory (input to M4-26, HEN-191)

**No card data anywhere:** digital goods are paid through Apple IAP or Google Play Billing; a payment provider is used only for physical goods and
payouts. We store only their transaction, product and receipt references. Payouts: provider account references only; no bank or ID documents (HEN-214).

| Data                                           | Where                           | At-rest protection                                                                         | Status                               | E2E (M6-14) changes it?                                                                             |
| ---------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Email (incl. Apple/Google and private relay)   | Postgres                        | AES-256-GCM + HMAC-SHA256 lookup hash, `key_version` (D18); two deploy-time secrets (D26). | Decided (D26, interim); KMS: HEN-191 | No                                                                                                  |
| Linked provider ids (provider id + `sub`)      | Postgres (`accounts`)           | Disk/volume encryption; opaque ids only, no name, photo or profile fields (D19)            | Decided (D19)                        | No                                                                                                  |
| Apple refresh token (only provider token kept) | Postgres (`accounts`)           | Field encryption with the D18 data key; used only to revoke on account deletion (D19)      | Decided (D19)                        | No                                                                                                  |
| Handle                                         | Postgres                        | Disk/volume encryption only (needs a unique index; shown to groups)                        | Proposal                             | No                                                                                                  |
| Sessions, OTP codes                            | Postgres                        | Disk/volume encryption; OTP stored hashed if Better Auth supports it (HEN-47 spike)        | OPEN (Sara)                          | No                                                                                                  |
| Source videos, transcodes, renders, thumbnails | Hetzner Object Storage          | Hetzner server-side encryption or client-side encryption: A4                               | OPEN (A4, owned by HEN-191)          | No: server-side analysis and masked renders need the plaintext                                      |
| User's tracks, masks, keypoints                | Object storage / Postgres       | Same as videos                                                                             | OPEN (A4, owned by HEN-191)          | No                                                                                                  |
| Timeline segments, corrections, priors         | Postgres                        | Disk/volume encryption                                                                     | Proposal                             | No                                                                                                  |
| Text notes                                     | Postgres                        | Field encryption with the HEN-63 module; no operator read path (DB role test)              | Proposal (M6-14 baseline)            | **Yes**: E2E would encrypt on the device; moderation and disputes would see only what users forward |
| Voice notes (audio)                            | Object storage                  | Per-object encryption; no operator read path                                               | Proposal (M6-14 baseline)            | **Yes**: as text notes, plus key handling for each grantee and on grant expiry                      |
| Review breakdowns (summary text)               | Postgres                        | Field encryption with the HEN-63 module                                                    | Proposal                             | **Yes**, if Henry includes reviews in E2E scope (HEN-201)                                           |
| Chat or messages                               | –                               | No chat is planned; only notes                                                             | OPEN (Henry, HEN-201)                | **Yes**, if chat is added                                                                           |
| Consent and attestation records                | Postgres                        | Disk/volume encryption (ids and version ids only, no free text)                            | Proposal                             | No                                                                                                  |
| Access grants, review requests, offers         | Postgres                        | Disk/volume encryption                                                                     | Proposal                             | E2E key distribution would hang off grants                                                          |
| Ratings                                        | Postgres                        | Disk/volume encryption (public by design)                                                  | Proposal                             | No                                                                                                  |
| Payment and payout references                  | Postgres                        | Disk/volume encryption; no card, bank or ID data (schema + log test, HEN-191)              | Decided (no card data)               | No                                                                                                  |
| Reports and moderation records                 | Postgres                        | Field encryption for reporter text                                                         | Proposal                             | With E2E the reporter's client forwards content (HEN-198)                                           |
| Job rows (pg-boss, not email), audit log       | Postgres                        | Ids and object keys only, so disk/volume encryption                                        | Proposal                             | No                                                                                                  |
| Email job rows (pg-boss `email_send`, §3.7)    | Postgres                        | Only what the send needs, sealed with the app data key (D18); deleted on send, 6 h max     | Decided (Sara, 2026-10-27)           | No                                                                                                  |
| Disk/volume encryption for Postgres            | Hetzner Cloud VM                | Method not checked (for example LUKS on the volume)                                        | OPEN (owned by HEN-191)              | –                                                                                                   |
| Backups                                        | Backup store                    | Encrypted before upload; method and key OPEN                                               | OPEN (owned by HEN-50)               | –                                                                                                   |
| Session token on the phone                     | iOS Keychain / Android Keystore | `@better-auth/expo` keeps tokens in SecureStore (D17 research)                             | Decided (D17)                        | E2E would add device keys here                                                                      |
| Recordings on the phone before upload          | App sandbox                     | OS file encryption only                                                                    | OPEN (Sara)                          | No                                                                                                  |
| Modal working copies                           | Modal ephemeral disk (EU)       | Modal platform controls; deleted when the container ends                                   | Per HEN-227                          | No                                                                                                  |
| Logs                                           | Hetzner, Modal                  | No email, IP, URL or filename in logs (A5, HEN-227)                                        | Decided                              | No                                                                                                  |

The honest limit (M4-26): with server-side keys, an operator who has the keys can still decrypt. The control is the DB roles, no admin read path and the
audit log; only E2E removes it.

## 7. Open questions

### For Henry

1. HEN-192 (M6-09): what reviewers and gym mates see (partner masked, or unmasked with per-video consent); informal group vs gym tenant; which belts can
   review; do gym-mate shares expire, and after how long?
2. How long does a paid reviewer's grant last, and who sets that window?
3. Do grantees see each other's notes? Do a grantee's notes stay with the owner after revoke or expiry?
4. What is an "offer" in the review flow (§2.6), and who sets the review price (HEN-203)?
5. Rating scale, whether ratings carry text, and what happens to ratings and delivered reviews when the rater or the reviewer deletes their account
   (HEN-207).
6. Chat or notes only, and E2E or Sara's baseline (HEN-201).
7. Length limits: text notes, voice notes (M6-12), review summaries, handles; and how long review requests and offers stay open.
8. Seller model (HEN-208): decides whose payment and payout records we hold, and so what the cascade must keep.

### Sara decisions (2026-10-22)

1. Job runner: **option A** decided (§3.1). The JS SDK `eu` call is a required spike in HEN-48.
2. `video_timeline_gemini` runs on the backend (Node, Vertex EU): decided. `video_transcode` stays OPEN; the HEN-87 spike decides it by measuring cost
   and runtime on a Hetzner VM vs Modal CPU (§3.2).
3. Queue settings (§3.4): accepted as starting values, tuned in M3.
4. Worker service token in Modal Secrets: accepted. Scope limited to the two internal routes, not user data, rotated on every deploy or at least every 90
   days; Modal's US-held metadata is already on the lawyer list (§3.6).
5. Signed-URL TTLs: 300 s for playback, 15 min for worker URLs: decided (§4.4, §3.6).
6. A4 video object encryption, Postgres volume encryption and D18 KMS stay OPEN, owned by HEN-191. Backup encryption and the backup window stay OPEN,
   owned by HEN-50 (§6).
7. Renumbering the repo's owner-unmasked decision in `DECISIONS.md` moves to HEN-70 (docs) (§0). Done: it is now repo D24.
8. UI kit: `@expo/ui` signed off for HEN-46 (§8).

### For the lawyer (through HEN-189 / HEN-209)

Every **OPEN FOR LAWYER** row in §5; whether the `ai_vendor` consent text must name Modal (our models on a processor) as well as Gemini; Modal's US-held
logs and metadata (already on the lawyer list).

## 8. UI kit for HEN-46 (signed off by Sara, 2026-10-22)

**Decision: `@expo/ui`, with our own design tokens on plain `StyleSheet`** (Sara, 2026-10-22, for HEN-46). Lydia's research leaned the same way.

| Option               | Fit with Expo SDK 57                                                                 | For                                                                                                                                                                                                                                                                                                                                                                     | Against                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **`@expo/ui`**       | Versioned with the SDK: 57.0.x, MIT; 57.0.22 is past the 14-day cooldown. In Expo Go | Real Jetpack Compose Material 3 on Android (NavigationBar, ModalBottomSheet, HorizontalFloatingToolbar, LoadingIndicator, dynamic colours, all in the SDK 57 docs) and SwiftUI on iOS, so iOS 26 Liquid Glass comes from system components. Drop-in replacement for `@gorhom/bottom-sheet` removes a single-maintainer dependency. Universal components also run on web | Production maturity not verified; layout inside a `Host` uses Row/Column, not Yoga; Skia still needed for the timeline |
| `react-native-paper` | 5.15.3 (May 2026), MIT, JS-rendered                                                  | Widely used; one JS-drawn look on both platforms                                                                                                                                                                                                                                                                                                                        | Material 3 but not Expressive (v6 in progress); Android styling on iOS; no native Liquid Glass                         |
| Tamagui              | 3.x latest is younger than the 14-day cooldown (newest allowed: 2.7.7), MIT          | Universal web + native with a compiler                                                                                                                                                                                                                                                                                                                                  | Highest adoption cost for 2–3 hours a week; a full design system we don't need                                         |

The rest of Lydia's proposed stack (expo-router, expo-video, Reanimated, Gesture Handler, Skia for the timeline) is outside this choice. Each package is
checked for an SDK 57 version that meets the cooldown when HEN-46 adds it.
