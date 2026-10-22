import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as sharedIndex from "../index.js";
import * as encryptionModule from "../encryption/index.js";

const sharedRoot = new URL("../../", import.meta.url);

describe("encryption module is server-only (HEN-63 AC 6)", () => {
  it("is not exported from src/index.ts", () => {
    const indexSource = readFileSync(new URL("src/index.ts", sharedRoot), "utf8");
    expect(indexSource).not.toMatch(/encryption/i);
    for (const exportName of Object.keys(encryptionModule)) {
      expect(Object.keys(sharedIndex)).not.toContain(exportName);
    }
  });

  it("is published only as the @bjj-roll/shared/encryption subpath", () => {
    const packageJson = JSON.parse(readFileSync(new URL("package.json", sharedRoot), "utf8")) as { exports: Record<string, unknown> };
    expect(Object.keys(packageJson.exports)).toEqual([".", "./encryption"]);
  });
});
