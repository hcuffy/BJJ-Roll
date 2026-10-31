/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AGE_ADULT_CONFIRMATION_NOTE } from "../auth/ageConfirmation";
import { failureMessages } from "../auth/signInActions";
import { socialNotLinked } from "../auth/socialSignIn";

const accountExistenceWording =
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
    expect(failureMessages.accountNotLinked).toBe("We couldn't sign you in this way. Sign in with your email instead.");
  });

  it("has no account-existence wording anywhere in app or shared source (copy or comments)", () => {
    const files = sourceDirectories.flatMap(listSourceFiles);
    expect(files.some((filePath) => filePath.endsWith("signInActions.ts"))).toBe(true);
    expect(AGE_ADULT_CONFIRMATION_NOTE).toBe("Only needed to buy things later. Already have an account? Confirm in Account.");
    for (const filePath of files) {
      expect(readFileSync(filePath, "utf8").replaceAll(AGE_ADULT_CONFIRMATION_NOTE, ""), filePath).not.toMatch(accountExistenceWording);
    }
  });
});
