/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FAILURE_MESSAGES } from "../auth/signInActions";
import { socialNotLinked } from "../auth/socialSignIn";

const ACCOUNT_EXISTENCE_WORDING =
  /already (?:has|have|belongs|exists|registered|in use|linked|signed up)|existing (?:account|user)|account exists|in use by/iu;
const sourceDirectories = ["..", "../../../shared/src"].map((relative) => fileURLToPath(new URL(relative, import.meta.url)));

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" ? [] : listSourceFiles(entryPath);
    }
    return /\.tsx?$/u.test(entry.name) ? [entryPath] : [];
  });
}

describe("HEN-239 sign-in copy never says whether an email has an account", () => {
  it("uses neutral copy that points to email sign-in, per provider", () => {
    expect(socialNotLinked("google")).toEqual({
      ok: false,
      reason: "accountNotLinked",
      message: "We couldn't sign you in with Google. Sign in with your email instead.",
    });
    for (const provider of ["apple", null] as const) {
      expect(socialNotLinked(provider)).toMatchObject({ message: "We couldn't sign you in this way. Sign in with your email instead." });
    }
    expect(FAILURE_MESSAGES.accountNotLinked).toBe("We couldn't sign you in this way. Sign in with your email instead.");
  });

  it("has no account-existence wording anywhere in app or shared source (copy or comments)", () => {
    const files = sourceDirectories.flatMap(listSourceFiles);
    expect(files.some((filePath) => filePath.endsWith("signInActions.ts"))).toBe(true);
    for (const filePath of files) {
      expect(readFileSync(filePath, "utf8"), filePath).not.toMatch(ACCOUNT_EXISTENCE_WORDING);
    }
  });
});
