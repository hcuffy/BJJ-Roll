# AGENTS.md

Guide for AI agents and contributors working in this repo.

## Setup

- Node 24 (`.nvmrc` pins `24.13.1`). `.npmrc` sets `engine-strict=true`.
- Install pnpm 11.21.0 directly: `npm i -g pnpm@11.21.0` or the standalone installer from pnpm.io. Do not use corepack. `packageManager` in `package.json` is a version marker only.

## Commands

- Install: `pnpm install`
- Lint: `pnpm lint` (fix: `pnpm fix`)
- Test: `pnpm test` (runs `test` in every workspace package)
- Database tests (`packages/backend`, Testcontainers with `postgres:18.6`) need Docker. Without Docker they are skipped locally; in CI (`CI=true`) they always run.
- Typecheck / build: `pnpm typecheck` / `pnpm build` (`tsc -b`)
- Format: `pnpm format`

## Leakcheck hook

- `pnpm install` runs `prepare`, which sets `git config core.hooksPath .githooks` and creates a starter `.leakcheck` if it is missing (`scripts/createStarterLeakcheck.sh`; generic secret patterns only, mode 600; an existing file is never read, printed or overwritten).
- `.githooks/pre-commit` checks the added lines of the staged diff against patterns in a local `.leakcheck` file at the repo root. On a match it prints the file name and the pattern's line number (never the matched text) and blocks the commit.
- It fails closed: without `.leakcheck`, with one that has no usable patterns, or with an invalid pattern, every commit is blocked.
- Matching is case-sensitive. Binary files are scanned as text. CRLF line endings in `.leakcheck` are fine.
- `git commit --no-verify` bypasses the hook. Do not use it to get past a leakcheck block.
- Add your personal patterns to the starter `.leakcheck` (or create it yourself): one extended regex (`grep -E`) per line; blank lines and lines starting with `#` are skipped. It is in `.gitignore`. Never commit it or paste real patterns into issues, PRs or CI logs.
- Self-test: `pnpm test:hooks` (temporary repo, dummy canary only).

## Workspace

- Packages live in `packages/*`, scoped `@bjj-roll/<name>`, linked with `workspace:*`.

## Conventions

- Follow CONVENTIONS.v2 (summarised in `.github/coderabbit.md`): strict TypeScript, ESM, double quotes, 2-space indent, trailing commas, full names instead of abbreviations, Vitest tests in `__tests__/` named `<module>.<scenario>.test.ts`.
- Architecture and tooling decisions are recorded in [`DECISIONS.md`](DECISIONS.md).

## Commits

- Imperative, sentence-case subject, no prefix (no Conventional Commits). Identifiers in backticks, e.g. ``Add `pnpm-workspace.yaml` ``.

## Branches and PRs

- Branch from `main`; the branch name contains the Linear issue ID (e.g. `hen-32-...`).
- Open a PR to `main` with `Fixes HEN-<n>` in the body.
- Never push directly to `main`. Never merge your own PR; a human merges after review.
