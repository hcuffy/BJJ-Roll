import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { ESLint, Linter } from "eslint";
import tseslint from "typescript-eslint";

const repoRoot = dirname(import.meta.dirname);
const eslint = new ESLint({ cwd: repoRoot });
const linter = new Linter();
const fetchSignalMessage = "Backend fetch calls need a timeout: pass signal: AbortSignal.timeout(...).";
const backendFiles = ["packages/backend/src/fixture.ts", "packages/backend/src/auth/fixture.ts"];
const testFile = "packages/backend/src/__tests__/fixture.test.ts";

const bannedCode = [
  'async function load(): Promise<Response> {\n  return await fetch("https://example.test", { method: "POST" });\n}',
  'async function load(): Promise<Response> {\n  return await globalThis.fetch("https://example.test");\n}',
  'async function load(client: { fetchImplementation: typeof fetch }): Promise<Response> {\n  return await client.fetchImplementation("https://example.test", {});\n}',
];
const allowedCode = [
  'async function load(): Promise<Response> {\n  return await fetch("https://example.test", { method: "POST", signal: AbortSignal.timeout(5000) });\n}',
];

async function fetchSignalMessages(filePath, code) {
  const { rules } = await eslint.calculateConfigForFile(filePath);
  const config = {
    files: ["**/*.ts"],
    languageOptions: { parser: tseslint.parser },
    rules: { "no-restricted-syntax": rules["no-restricted-syntax"] ?? "off" },
  };
  return linter
    .verify(code, config, { filename: join(repoRoot, filePath) })
    .filter((message) => message.ruleId === "no-restricted-syntax" && message.message === fetchSignalMessage);
}

describe("backend fetch without a timeout signal", () => {
  for (const filePath of backendFiles) {
    for (const code of bannedCode) {
      it(`${filePath} rejects a fetch with no signal`, async () => {
        assert.equal((await fetchSignalMessages(filePath, code)).length, 1);
      });
    }
    for (const code of allowedCode) {
      it(`${filePath} allows a fetch with a timeout signal`, async () => {
        assert.deepEqual(await fetchSignalMessages(filePath, code), []);
      });
    }
  }

  it(`${testFile} is outside the ban`, async () => {
    assert.deepEqual(await fetchSignalMessages(testFile, bannedCode[0]), []);
  });

  it("packages/backend/src/auth keeps the catch-return ban alongside the fetch ban", async () => {
    const { rules } = await eslint.calculateConfigForFile(backendFiles[1]);
    const messages = rules["no-restricted-syntax"].slice(1).map((entry) => entry.message);
    assert.ok(messages.some((message) => message.startsWith("In src/auth, a catch must not only return null or false")));
  });
});
