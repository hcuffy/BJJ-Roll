/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceDirectory = fileURLToPath(new URL("..", import.meta.url));

function listAppSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" ? [] : listAppSourceFiles(entryPath);
    }
    return /\.tsx?$/u.test(entry.name) ? [entryPath] : [];
  });
}

describe("mobile app source", () => {
  const sourceFiles = listAppSourceFiles(sourceDirectory).map((filePath) => ({ filePath, text: readFileSync(filePath, "utf8") }));

  it("has auth screens to check", () => {
    expect(sourceFiles.some(({ filePath }) => filePath.endsWith("EmailEntryScreen.tsx"))).toBe(true);
  });

  it("has no password field", () => {
    for (const { filePath, text } of sourceFiles) {
      expect(text, filePath).not.toMatch(/secureTextEntry|password/iu);
    }
  });

  it("never logs (so no email or code reaches a log) and shows no dev-only code", () => {
    for (const { filePath, text } of sourceFiles) {
      expect(text, filePath).not.toMatch(/console\.|__DEV__|devCode/u);
    }
  });

  it("takes the 17+ rule from @bjj-roll/shared instead of a local copy (HEN-77)", () => {
    const ageConfirmation = sourceFiles.find(({ filePath }) => filePath.endsWith("ageConfirmation.ts"));
    expect(ageConfirmation?.text).toMatch(/from "@bjj-roll\/shared"/u);
    for (const { filePath, text } of sourceFiles) {
      expect(text, filePath).not.toMatch(/You must be 17 or older|TODO\(HEN-77\)/u);
    }
  });
});
