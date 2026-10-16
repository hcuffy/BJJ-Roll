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

Run the tests with `pnpm test`.

## License

Licensed under the Apache License 2.0. See [LICENSE](LICENSE) for details.

Copyright 2026 Henry Cuffy
