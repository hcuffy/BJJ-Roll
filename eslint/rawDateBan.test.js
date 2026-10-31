import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { ESLint, Linter } from "eslint";
import tseslint from "typescript-eslint";

const repoRoot = dirname(import.meta.dirname);
const eslint = new ESLint({ cwd: repoRoot });
const linter = new Linter();
const rawDateMessage = "Use the package's src/dates.ts (dayjs) instead of the raw Date clock or constructor.";
const lintedFiles = [
  "packages/backend/src/fixture.ts",
  "packages/shared/src/fixture.ts",
  "packages/mobile/src/fixture.tsx",
  "packages/frontend/src/fixture.tsx",
];
const dateBoundaryFiles = ["packages/backend/src/dates.ts", "packages/mobile/src/dates.ts"];

const bannedCode = [
  "const startedAt = new Date();",
  "const nowMs = Date.now();",
  'const parsedMs = Date.parse("2026-10-31T10:00:00.000Z");',
  "const utcMs = Date.UTC(2026, 9, 31);",
  "const DateClass = globalThis.Date;",
  "const startedAt = new globalThis.Date();",
  "const nowMs = globalThis.Date.now();",
];
const allowedCode = ["function toLabel(value: Date): string {\n  return value.toISOString();\n}", 'const parsed = globalThis.JSON.parse("{}");'];

async function rawDateMessages(filePath, code) {
  const { rules } = await eslint.calculateConfigForFile(filePath);
  const config = {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: { "no-restricted-syntax": rules["no-restricted-syntax"] ?? "off" },
  };
  return linter
    .verify(code, config, { filename: join(repoRoot, filePath) })
    .filter((message) => message.ruleId === "no-restricted-syntax" && message.message === rawDateMessage);
}

describe("raw Date ban", () => {
  for (const filePath of lintedFiles) {
    for (const code of bannedCode) {
      it(`${filePath} rejects ${code}`, async () => {
        assert.equal((await rawDateMessages(filePath, code)).length, 1);
      });
    }
    for (const code of allowedCode) {
      it(`${filePath} allows ${code}`, async () => {
        assert.deepEqual(await rawDateMessages(filePath, code), []);
      });
    }
  }

  for (const filePath of dateBoundaryFiles) {
    for (const code of bannedCode) {
      it(`${filePath} may use ${code}`, async () => {
        assert.deepEqual(await rawDateMessages(filePath, code), []);
      });
    }
  }
});
