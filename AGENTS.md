# AGENTS.md

Guide for AI agents and contributors working in this repo. Contribution rules: [CONTRIBUTING.md](CONTRIBUTING.md). Design: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Setup

- Node 24 (`.nvmrc` pins `24.13.1`). `.npmrc` sets `engine-strict=true`.
- Install pnpm 11.21.0 directly: `npm i -g pnpm@11.21.0` or the standalone installer from pnpm.io. Do not use corepack. `packageManager` in `package.json` is a version marker only.

## Commands

- Install: `pnpm install`
- Lint: `pnpm lint` (fix: `pnpm fix`)
- Test: `pnpm test` (runs `test` in every workspace package)
- Database tests (`packages/backend`, Testcontainers with `postgres:18.6`) need Docker. Without Docker they are skipped locally; in CI (`CI=true`) they always run.
- Typecheck / build: `pnpm typecheck` / `pnpm build` (`tsc -b`)
- Format: `pnpm format` (check only: `pnpm format:check`)

## Per-package commands

Run from the repo root.

- Shared (`@bjj-roll/shared`): `pnpm --filter @bjj-roll/shared test`
- Backend (`@bjj-roll/backend`): `pnpm --filter @bjj-roll/backend test`; run with `pnpm build` then `pnpm --filter @bjj-roll/backend start`
- Mobile (`@bjj-roll/mobile`): `pnpm --filter @bjj-roll/mobile typecheck`, `pnpm --filter @bjj-roll/mobile test`, `pnpm --filter @bjj-roll/mobile start`, `pnpm --filter @bjj-roll/mobile bundle`
- Frontend (`@bjj-roll/frontend`): `pnpm --filter @bjj-roll/frontend typecheck`, `pnpm --filter @bjj-roll/frontend test`, `pnpm --filter @bjj-roll/frontend build`, `pnpm --filter @bjj-roll/frontend dev`
- Workers (`packages/workers`, Python): `cd packages/workers && uv sync --locked && uv run ruff check && uv run ruff format --check && uv run pytest`

## Leakcheck hook

- `pnpm install` runs `prepare`, which sets `git config core.hooksPath .githooks` and creates a starter `.leakcheck` if it is missing (`scripts/createStarterLeakcheck.sh`; generic secret patterns only, mode 600; an existing file is never read, printed or overwritten). The starter contains the marker line `# leakcheck-starter: delete this line after adding personal patterns`; while that exact line is in `.leakcheck`, the hook blocks every commit.
- `.githooks/pre-commit` checks the added lines of the staged diff against patterns in a local `.leakcheck` file at the repo root. On a match it prints the file name and the pattern's line number (never the matched text) and blocks the commit.
- It fails closed: without `.leakcheck`, with one that has no usable patterns, or with an invalid pattern, every commit is blocked.
- Matching is case-sensitive. Binary files are scanned as text. CRLF line endings in `.leakcheck` are fine.
- `git commit --no-verify` bypasses the hook. Do not use it to get past a leakcheck block.
- Add your personal patterns (emails, full name, home path) to the starter `.leakcheck`, then delete the marker line (or create the file yourself): one extended regex (`grep -E`) per line; blank lines and lines starting with `#` are skipped. It is in `.gitignore`. Never commit it or paste real patterns into issues, PRs or CI logs.
- Self-test: `pnpm test:hooks` (temporary repo, dummy canary only).

## Python workers

- `packages/workers` is Python, not a pnpm package. Python is pinned to `3.15.0` (`packages/workers/.python-version`); install uv 0.13.1 directly (no other Python setup needed, uv fetches 3.15.0).
- Setup: `cd packages/workers && uv sync --locked` (`uv.lock` is committed).
- Lint: `uv run ruff check` and `uv run ruff format --check` (line length 150, double quotes, 4-space indent). Test: `uv run pytest`.
- Tests live in `packages/workers/tests/`, named `test_<module>_<scenario>.py`. Full variable names apply here too.

## Workspace

- Packages live in `packages/*`, scoped `@bjj-roll/<name>`, linked with `workspace:*`.

## Conventions

- Follow CONVENTIONS.v2 (summarised in `.github/coderabbit.md`): strict TypeScript, ESM, double quotes, 2-space indent, trailing commas, full names instead of abbreviations, Vitest tests in `__tests__/` named `<module>.<scenario>.test.ts`.
- TS types (lint errors): `interface` for object shapes, `type` only for unions, intersections, tuples, mapped/conditional types and primitive aliases; `import type` for type-only imports; no `any` (use `unknown` and narrow); `declare global` only in a package's `globals.d.ts`.
- Architecture and tooling decisions are recorded in [`DECISIONS.md`](DECISIONS.md).

## Commits

- Imperative, sentence-case subject, no prefix (no Conventional Commits). Identifiers in backticks, e.g. ``Add `pnpm-workspace.yaml` ``.

## Branches and PRs

- Branch from `main`; the branch name contains the Linear issue ID (e.g. `hen-32-...`).
- Open a PR to `main` with `Fixes HEN-<n>` in the body.
- Never push directly to `main`. Never merge your own PR; a human merges after review.

## GitHub Actions pins

- Every third-party action (`uses:`) in `.github/workflows/` is pinned to a full 40-character commit SHA with the version tag in a trailing comment: `uses: actions/checkout@<40-char sha> # v4.4.0`. Local actions (`./...`) are exempt; Docker actions use an `@sha256:` digest.
- Every workflow has a top-level `permissions:` block (normally `contents: read`); a job raises only what it needs. No `pull_request_target`, no new secrets.
- Find the SHA for a tag: `git ls-remote --tags https://github.com/<owner>/<repo> 'refs/tags/<tag>' 'refs/tags/<tag>^{}'`. Use the `^{}` line if there is one (annotated tag), else the plain line. Pick a release that is at least 14 days old.
- The `pin-check` workflow (`scripts/checkWorkflowPins.sh`) enforces both rules on every PR. Run it locally with `pnpm test:pins`.
- Dependabot (`github-actions`, 14-day cooldown) updates the SHA and keeps the version comment.

## Security update younger than 14 days

- pnpm `minimumReleaseAge` stays 14 days, with no standing excludes. Dependabot (`.github/dependabot.yml`) uses `cooldown.default-days: 14`.
- Urgent-fix path: a `minimumReleaseAge` exclude for that one package only, added only after Henry's written OK (link or quote in the handoff file).
- Remove the exclude in a follow-up PR once the version is 14 days old.
- Never more than one package per OK. No blanket excludes.
