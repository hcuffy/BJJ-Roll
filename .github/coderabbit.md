# BJJ-Roll review guide

## Structure

- pnpm workspace; packages live in `packages/*` and are scoped `@bjj-roll/<name>`.
- Internal dependencies use `workspace:*`.

## Style (CONVENTIONS.v2)

- TypeScript strict, ESM (`type: module`), NodeNext module resolution.
- Prettier: double quotes, semicolons, 2-space indent, trailing commas `all`, print width 150.
- No `any`, no floating promises, `curly: all`, at most 3 parameters, at most 250 lines per file.

## Naming

- Use full names, not abbreviations (`button`, not `btn`). Allowed short names: `db`, `env`, `deps`, `props`, `id`.
- Catch variables are named `error`.

## Testing

- Vitest. Tests live in colocated `__tests__/` folders.
- File names follow `<module>.<scenario>.test.ts`.
- Tests must be deterministic and must not need network access or secrets.

## Review checklist

- [ ] PR is small and covers one issue; body contains `Fixes HEN-<n>`.
- [ ] `pnpm lint` and `pnpm test` pass in CI.
- [ ] No secrets, credentials or personal data committed.
- [ ] New code has tests where behaviour changes.
- [ ] Commit subjects are imperative, sentence case, no prefix.
