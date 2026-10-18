# BJJ Roll Analysis

Tools for analyzing Brazilian Jiu-Jitsu rolls.

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
