# BJJ Roll Analysis

Tools for analyzing Brazilian Jiu-Jitsu rolls.

## Local setup

Prerequisites (exact versions):

- Node 24 (`.nvmrc` pins `24.13.1`; `nvm use` picks it up).
- pnpm 11.21.0, installed directly (`npm i -g pnpm@11.21.0` or the standalone installer from pnpm.io). Do not use corepack.
- Docker, for the backend database tests (Testcontainers starts `postgres:18.6`).
- uv 0.13.1 for the Python workers. uv fetches Python 3.15.0 itself (`packages/workers/.python-version`).

No running Postgres is needed yet: tests start their own `postgres:18.6` container with Testcontainers (Docker required). A compose file comes with the first DB-backed dev route.

1. Run `pnpm install`. It turns on the commit hook (`.githooks`) and creates a starter `.leakcheck` with generic secret patterns if you do not have one yet. The starter blocks every commit until you add your personal patterns and delete its marker line. `pnpm install` needs a POSIX `sh` for this step: fine on Linux and macOS; on Windows use Git Bash or WSL (plain `cmd` is not supported).
2. Add your personal patterns to `.leakcheck`, one extended regex per line, then delete the line `# leakcheck-starter: delete this line after adding personal patterns`. Example patterns (made up):

   ```text
   jane\.doe@example\.com
   Jane Q\. Doe
   /home/janedoe
   ```

   `.leakcheck` is gitignored. Never commit it, and never use `git commit --no-verify` to get past a block. Details: [AGENTS.md, "Leakcheck hook"](AGENTS.md#leakcheck-hook).

3. Run the checks. All of them should pass on a fresh clone:

   ```sh
   pnpm typecheck
   pnpm lint
   pnpm format:check
   pnpm test
   cd packages/workers && uv sync --locked && uv run ruff check && uv run pytest
   ```

4. Start the app: `pnpm --filter @bjj-roll/mobile start`, then press `a` to open it in the Android emulator, or `i` for the iOS simulator (macOS with Xcode only).

Troubleshooting "Downloading Expo Go" stuck at 0%: check that the emulator has internet access, cold boot the emulator, or install Expo Go from the Play Store in the emulator. Restarting with `pnpm --filter @bjj-roll/mobile start --clear` also helps.

## Backend

Requires Node 24 and pnpm 11.21.0 installed directly (see `AGENTS.md`).

```sh
pnpm install
pnpm build
pnpm --filter @bjj-roll/backend start
curl http://localhost:3000/health
# {"status":"ok"}
```

Run the tests with `pnpm test`. The backend database tests start a Postgres container (Testcontainers, `postgres:18.6`), so they need Docker; without Docker they are skipped locally.

## Mobile

Expo app in `packages/mobile` (`@bjj-roll/mobile`, Expo SDK 57). No Expo account or EAS is needed.

```sh
pnpm install
pnpm --filter @bjj-roll/mobile start   # dev server; open in Expo Go, an Android emulator or the iOS simulator
pnpm --filter @bjj-roll/mobile bundle  # headless Android bundle into packages/mobile/dist
pnpm --filter @bjj-roll/mobile exec expo export --platform ios --output-dir dist  # headless iOS bundle (runs on Linux, no Mac or Apple account)
```

## Workers

Python workers in `packages/workers` (Python 3.15.0, uv 0.13.1, Ruff, pytest).

```sh
cd packages/workers
uv sync --locked
uv run ruff check
uv run ruff format --check
uv run pytest
```

## License

Licensed under the Apache License 2.0. See [LICENSE](LICENSE) for details.

Copyright 2026 Henry Cuffy
