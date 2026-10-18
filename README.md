# BJJ Roll Analysis

Tools for analyzing Brazilian Jiu-Jitsu rolls.

## Local setup

1. Install Node 24 (`.nvmrc`) and pnpm 11.21.0 directly (`npm i -g pnpm@11.21.0`). Do not use corepack.
2. Run `pnpm install`. It turns on the commit hook (`.githooks`) and creates a starter `.leakcheck` with generic secret patterns if you do not have one yet.
3. Add your personal patterns to `.leakcheck`, one extended regex per line, for example (made up):

   ```text
   jane\.doe@example\.com
   Jane Q\. Doe
   /home/janedoe
   ```

   `.leakcheck` is gitignored. Never commit it, and never use `git commit --no-verify` to get past a block. Details: [AGENTS.md, "Leakcheck hook"](AGENTS.md#leakcheck-hook).

4. Start the app: `pnpm --filter @bjj-roll/mobile start`, then press `a` to open it in the Android emulator.

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

Expo app in `packages/mobile` (`@bjj-roll/mobile`, Expo SDK 58). No Expo account or EAS is needed.

```sh
pnpm install
pnpm --filter @bjj-roll/mobile start   # dev server; open in Expo Go or an Android emulator
pnpm --filter @bjj-roll/mobile bundle  # headless Android bundle into packages/mobile/dist
```

## License

Licensed under the Apache License 2.0. See [LICENSE](LICENSE) for details.

Copyright 2026 Henry Cuffy
