# Contributing

Short rules for every change to this repo. Setup and checks: [README.md](README.md#local-setup). Agent guide and per-package commands: [AGENTS.md](AGENTS.md).

## Branches and pull requests

- Branch from `main`. The branch name contains the Linear issue id, e.g. `hen-70-docs-local-dev`.
- Open a pull request to `main`. The body is short and contains `Fixes <issue id>`, e.g. `Fixes HEN-70`.
- One deliverable per pull request.
- Henry reviews and merges. Never push directly to `main` and never merge your own pull request.
- To update a branch, merge `main` into it. Do not rebase or force-push.

## Commits

- Subjects are imperative and sentence case, with no prefix (no Conventional Commits) and identifiers in backticks, e.g. ``Add `pnpm-workspace.yaml` ``.
- Never use `git commit --no-verify`. The leakcheck pre-commit hook must pass (see [AGENTS.md, "Leakcheck hook"](AGENTS.md#leakcheck-hook)).

## Dependencies

- pnpm `minimumReleaseAge` is 14 days (`pnpm-workspace.yaml`), with no standing excludes. New dependencies use the newest version older than 14 days.
- The only exception is the urgent-fix path in [AGENTS.md, "Security update younger than 14 days"](AGENTS.md#security-update-younger-than-14-days).

## Conventions

- Code style follows CONVENTIONS.v2, summarised in [`.github/coderabbit.md`](.github/coderabbit.md).
- TS types (lint errors): `interface` for object shapes, `type` only for unions, intersections, tuples, mapped/conditional types and primitive aliases; `import type` for type-only imports; no `any` (use `unknown` and narrow); `declare global` only in a package's `globals.d.ts`.
- Architecture and tooling decisions live in [`DECISIONS.md`](DECISIONS.md) and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
