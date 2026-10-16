# AGENTS.md

Guide for AI agents and contributors working in this repo.

## Setup
- Node 24 (`.nvmrc` pins `24.13.1`). `.npmrc` sets `engine-strict=true`.
- Install pnpm 11.21.0 directly: `npm i -g pnpm@11.21.0` or the standalone installer from pnpm.io. Do not use corepack. `packageManager` in `package.json` is a version marker only.

## Commands
- Install: `pnpm install`
- Lint: `pnpm lint` (fix: `pnpm fix`)
- Test: `pnpm test` (runs `test` in every workspace package)
- Typecheck / build: `pnpm typecheck` / `pnpm build` (`tsc -b`)
- Format: `pnpm format`

## Workspace
- Packages live in `packages/*`, scoped `@bjj-roll/<name>`, linked with `workspace:*`.

## Conventions
- Follow CONVENTIONS.v2 (summarised in `.github/coderabbit.md`): strict TypeScript, ESM, double quotes, 2-space indent, trailing commas, full names instead of abbreviations, Vitest tests in `__tests__/` named `<module>.<scenario>.test.ts`.

## Commits
- Imperative, sentence-case subject, no prefix (no Conventional Commits). Identifiers in backticks, e.g. ``Add `pnpm-workspace.yaml` ``.

## Branches and PRs
- Branch from `main`; the branch name contains the Linear issue ID (e.g. `hen-32-...`).
- Open a PR to `main` with `Fixes HEN-<n>` in the body.
- Never push directly to `main`. Never merge your own PR; a human merges after review.
