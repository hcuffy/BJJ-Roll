# Modal EU residency (HEN-227)

User-data jobs (`video_track`, `video_classify`, `video_render_masked`) run on Modal in the EU. The label "Gate: Modal DPA" stays on HEN-227: nothing is
deployed to Modal and no data is sent to it until that gate clears.

## Rules

- Every user-data function in `packages/workers/src/bjj_roll_workers/modal_app.py` sets `region="eu"`, `routing_region="eu-west"` and
  `enable_memory_snapshot=False`. `routing_region` can only be set at the first deploy, so the first `modal deploy` must already carry it.
- Node calls these functions only with `.remote(jobId, inputObjectKey)` (`packages/backend/src/jobs/modalJobCaller.ts`, HEN-48 option A). Spawn-style calls
  route inputs through us-east and are forbidden.
- The call input is a job ID and a server-built object key (`modalCallInputSchema`): no bytes, URL, query string, email or filename. Results stay under
  2 MiB, because larger inputs and outputs are stored in us-east ([region selection](https://modal.com/docs/guide/region-selection)).
- Logs hold the job ID, timings and the error class only; error messages are dropped on both sides.
- No `CloudBucketMount`, Volumes, Dicts or Queues in the Modal app: the worker reads the video through a short-lived presigned URL (ARCHITECTURE §3.6,
  built in the spikes) and Modal Secrets hold no storage keys.
- Proof: `sh scripts/checkModalResidency.sh` (CI step "Modal EU residency guard"), `tests/test_modal_app_eu_residency.py`, and the payload and log-scrub tests.

## Expected monthly cost (Starter plan)

Rates from [Modal pricing](https://modal.com/pricing), read 2026-10-29. Starter is $0 per month plus compute, with $30 of compute included each month.
Region pinning multiplies compute by 1.15 to 1.75 ([region selection](https://modal.com/docs/guide/region-selection)); `eu` is a broad region (1.15).

| Item      | Base rate             | With `eu` (x1.15) | Covered by the $30 credit |
| --------- | --------------------- | ----------------- | ------------------------- |
| Nvidia L4 | $0.000222 / s         | $0.92 / hour      | about 32 GPU hours        |
| Nvidia T4 | $0.000164 / s         | $0.68 / hour      | about 44 GPU hours        |
| CPU       | $0.0000131 / core / s | x1.15             | shared with GPU time      |
| Memory    | $0.00000222 / GiB / s | x1.15             | shared with GPU time      |

- **This change:** $0. It deploys and runs nothing.
- **Per roll:** not known until the HEN-48 spike measures GPU seconds per job. Until then the monthly cost is only the table above times usage, kept
  under the plan's EUR 50-100 cap (PLAN cost AC 11).
- **EU GPU capacity:** [U until tested]. Starter allows 10 concurrent GPUs; whether `eu` has L4 or T4 capacity when we need it is checked in the spike.

## Open

- The deploy output proving `eu` / `eu-west` needs a Modal token and is open until the DPA gate clears (decided by Sara and Henry).
- The Python `modal` package is not pinned yet: 1.6.1 does not support Python 3.15, and 1.6.2 (the first that does, published 2026-10-16) is under the
  14-day release age until 2026-10-30. Tests read `modal_app.py` as a syntax tree and never import `modal`.
