import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { ESLint, Linter } from "eslint";
import tseslint from "typescript-eslint";

const repoRoot = dirname(import.meta.dirname);
const eslint = new ESLint({ cwd: repoRoot });
const linter = new Linter();
const catchReturnMessage = "In src/auth, a catch must not only return null or false; rethrow anything that is not an expected auth miss.";
const authFile = "packages/backend/src/auth/fixture.ts";
const nonAuthFile = "packages/backend/src/fixture.ts";

const bannedCode = [
  "async function lookup(): Promise<string | null> {\n  try {\n    return await load();\n  } catch {\n    return null;\n  }\n}",
  "async function check(): Promise<boolean> {\n  try {\n    return await load();\n  } catch (error) {\n    return false;\n  }\n}",
];
const allowedCode = [
  "async function lookup(): Promise<string | null> {\n  try {\n    return await load();\n  } catch (error) {\n    if (isMiss(error)) {\n      return null;\n    }\n    throw error;\n  }\n}",
  "async function lookup(): Promise<string | undefined> {\n  try {\n    return await load();\n  } catch {\n    return undefined;\n  }\n}",
];

async function catchReturnMessages(filePath, code) {
  const { rules } = await eslint.calculateConfigForFile(filePath);
  const config = {
    files: ["**/*.ts"],
    languageOptions: { parser: tseslint.parser },
    rules: { "no-restricted-syntax": rules["no-restricted-syntax"] ?? "off" },
  };
  return linter
    .verify(code, config, { filename: join(repoRoot, filePath) })
    .filter((message) => message.ruleId === "no-restricted-syntax" && message.message === catchReturnMessage);
}

describe("auth catch-return-null ban", () => {
  for (const code of bannedCode) {
    it(`${authFile} rejects a catch that only returns null or false`, async () => {
      assert.equal((await catchReturnMessages(authFile, code)).length, 1);
    });
    it(`${nonAuthFile} is outside the ban`, async () => {
      assert.deepEqual(await catchReturnMessages(nonAuthFile, code), []);
    });
  }
  for (const code of allowedCode) {
    it(`${authFile} allows a catch that rethrows or returns something else`, async () => {
      assert.deepEqual(await catchReturnMessages(authFile, code), []);
    });
  }

  it(`${authFile} keeps the raw Date and global augmentation bans`, async () => {
    const { rules } = await eslint.calculateConfigForFile(authFile);
    const messages = rules["no-restricted-syntax"].slice(1).map((entry) => entry.message);
    assert.ok(messages.includes("Global augmentation goes only in the package's globals.d.ts."));
    assert.ok(messages.includes("Use the package's src/dates.ts (dayjs) instead of the raw Date clock or constructor."));
  });
});
