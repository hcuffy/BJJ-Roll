import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { ESLint, Linter } from "eslint";
import tseslint from "typescript-eslint";

const repoRoot = dirname(import.meta.dirname);
const eslint = new ESLint({ cwd: repoRoot });
const linter = new Linter();
const lintedFiles = [
  "packages/backend/src/fixture.ts",
  "packages/shared/src/fixture.ts",
  "packages/mobile/src/fixture.tsx",
  "packages/frontend/src/fixture.tsx",
];

const bannedImports = [
  'import _ from "lodash";',
  'import groupBy from "lodash/groupBy";',
  'import { groupBy } from "lodash-es";',
  'import groupBy from "lodash.groupby";',
  'import _ from "underscore";',
  'import toolkit from "es-toolkit";',
  'import * as toolkit from "es-toolkit";',
  'import { groupBy } from "es-toolkit/compat";',
];
const allowedImports = ['import { groupBy } from "es-toolkit";', 'import { chunk, uniq as uniqueValues } from "es-toolkit";'];

async function restrictedImportMessages(filePath, code) {
  const { rules } = await eslint.calculateConfigForFile(filePath);
  const config = {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: { "no-restricted-imports": rules["no-restricted-imports"] ?? "off" },
  };
  return linter.verify(code, config, { filename: join(repoRoot, filePath) }).filter((message) => message.ruleId === "no-restricted-imports");
}

describe("utility imports", () => {
  for (const filePath of lintedFiles) {
    for (const code of bannedImports) {
      it(`${filePath} rejects ${code}`, async () => {
        assert.equal((await restrictedImportMessages(filePath, code)).length, 1);
      });
    }
    for (const code of allowedImports) {
      it(`${filePath} allows ${code}`, async () => {
        assert.deepEqual(await restrictedImportMessages(filePath, code), []);
      });
    }
  }

  it("client code still rejects the server-only encryption module", async () => {
    const messages = await restrictedImportMessages("packages/mobile/src/fixture.tsx", 'import { sealEmail } from "@bjj-roll/shared/encryption";');
    assert.equal(messages.length, 1);
  });
});
