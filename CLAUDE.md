# CLAUDE.md

@AGENTS.md
@CONTRIBUTING.md

AGENTS.md holds the builder contract (Linear statuses, git, PR body, proof, checks). CONTRIBUTING.md holds commits and code style. This file adds only what those two leave out.

## Stack

- pnpm workspace, `packages/*`: `backend` (Better Auth, Kysely, pg-boss, Postgres), `frontend`, `mobile` (Expo), `shared` (Zod schemas), `workers` (Python 3.13+/3.15, uv, Ruff, pytest).
- Node 24 (`.nvmrc`), pnpm 11.21.0 (`packageManager`). Design rationale: `DECISIONS.md` and `docs/ARCHITECTURE.md`.

## Install

- `pnpm install --frozen-lockfile` with pnpm 11.21.0, installed directly (no corepack).
- `minimumReleaseAge` is 14 days and pnpm enforces it even with `--frozen-lockfile`: a lockfile entry younger than 14 days fails the install.
- New dependencies use the newest version older than 14 days.
- `minimumReleaseAgeExclude` holds exact `name@version` entries only, each with the repo owner's written OK and a removal date in the comment above it. Remove the entry once that version is 14 days old.

## Checks before done

Run the AGENTS.md check list, plus whichever of these your change touches:

```sh
pnpm test:hooks
pnpm --filter @bjj-roll/frontend typecheck && pnpm --filter @bjj-roll/frontend build
pnpm --filter @bjj-roll/mobile run payment-guard
pnpm --filter @bjj-roll/mobile bundle
sh scripts/checkModalResidency.test.sh && sh scripts/checkModalResidency.sh
```

CI also runs gitleaks on the PR's commit range and OSV-Scanner on `pnpm-lock.yaml` and `packages/workers/uv.lock` (`osv-scanner.toml`). Both must be green. A red OSV run that is also red on `main` is a `main` issue: note it in the proof.

## TypeScript typing

Lint enforces most of these; follow all of them:

1. Keep a type local to the module that uses it; export it only when another file needs it.
2. Types shared within a feature folder go in that folder's `types.ts`. No global `types/` folder.
3. Global types only for `Window` / `process.env` augmentation, third-party type patches and untyped modules: `declare global` in `globals.d.ts` with `export {}`.
4. `interface` for object shapes, class contracts and public APIs.
5. `type` for unions, intersections, tuples, mapped and conditional types, and primitive aliases.
6. `@typescript-eslint/consistent-type-definitions: ["error", "interface"]`.
7. Type-only imports use `import type { X }`.
8. Derive instead of restating: `ReturnType<typeof fn>`, `z.infer<typeof schema>`, `Pick` / `Omit`.
9. `unknown` plus narrowing, never `any`.
10. No global interface declaration merging.

## Flow

- Feature branch, small draft PR, one deliverable. The repo owner merges; nothing lands on `main` any other way.
- Proof (logs, screenshots, test output, evidence files) stays out of the repo and off GitHub.
- Dependabot opens one PR per repo for all updates, majors included (`.github/dependabot.yml`). Keep it that way.
- A change touching sign-in, payments, privacy, video, or the store listing or build needs a store-review pass before merge. Say so in the proof.

## Product calls already made

Code must keep these. A change to one is the repo owner's call, not a code fix.

- Age gate: 16+ minimum, optional 18+ for purchases. A re-send that flips 18+ while 16+ stays ticked keeps the first answers locked for 15 minutes, with no notice to the user.
- Handles can change, with a 7-day cooldown.
- Magic link: `GET` shows a Continue page; only its `POST` signs in.
- Biometric lock runs at cold start only.
- Sign in with Apple is iOS-only and hidden on Android.
- No auth answer reveals whether an account exists (D28).
