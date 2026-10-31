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
- No code comments or docstrings in TS/JS or Python (lint error: `pnpm test:comments` + `pnpm lint`, `scripts/check_no_comments.py`). Only directives stay: `eslint-disable-next-line … -- reason`, `@ts-expect-error reason`, `/// <reference …/>`, a licence header, shebangs, `# noqa: CODE - reason`, `# type: ignore[code]  # reason`. Rationale goes in DECISIONS.md (D33).
- Names (lint errors): functions, variables, hooks (`useX`) and style objects camelCase; PascalCase only for React components in `.tsx` and for types, interfaces and enums; UPPER_CASE only for module-level `const` primitives (string, number, boolean). Python follows pep8-naming (ruff `N`).
- Dates (lint error): use the package's `src/dates.ts` (dayjs) for the clock, parsing, arithmetic and formatting; `new Date` and `Date.now` only inside that file and in tests. `Date` stays only as a type where an API needs it. Python workers keep `datetime`.
- Architecture and tooling decisions live in [`DECISIONS.md`](DECISIONS.md) and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
