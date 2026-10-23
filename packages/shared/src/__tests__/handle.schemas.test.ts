import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  handleAvailabilityResponseSchema,
  handleMaximumLength,
  handleMinimumLength,
  handleSchema,
  isReservedHandle,
  reservedHandles,
  setHandleRequestSchema,
  userSchema,
} from "../index.js";

const userId = "01964c3a-7f00-7000-8000-000000000001";
const timestamp = "2026-10-23T08:00:00.000Z";
const forbiddenRealNameKeys = ["name", "realName", "fullName", "firstName", "lastName", "displayName"];

function alternateCase(input: string): string {
  return [...input].map((character, index) => (index % 2 === 0 ? character.toUpperCase() : character.toLowerCase())).join("");
}

describe("handleSchema and reservedHandles (HEN-64)", () => {
  it("accepts valid handles, trims whitespace, and normalizes to lowercase using limits constants", () => {
    expect(handleSchema.parse("ab_1")).toBe("ab_1");
    expect(handleSchema.parse("ABC")).toBe("abc");
    expect(handleSchema.parse("  Ab_1  ")).toBe("ab_1");

    const minimumLengthCandidate = "a".repeat(handleMinimumLength);
    const maximumLengthCandidate = "b".repeat(handleMaximumLength);

    expect(handleSchema.parse(minimumLengthCandidate)).toBe(minimumLengthCandidate);
    expect(handleSchema.parse(maximumLengthCandidate)).toBe(maximumLengthCandidate);
  });

  it("rejects too-short, too-long, punctuation, space, and non-ASCII handles using limits constants", () => {
    const belowMinimumCandidate = "a".repeat(handleMinimumLength - 1);
    const aboveMaximumCandidate = "a".repeat(handleMaximumLength + 1);
    const paddedBelowMinimumCandidate = `  ${belowMinimumCandidate}  `;

    const invalidCandidates = [
      belowMinimumCandidate,
      aboveMaximumCandidate,
      paddedBelowMinimumCandidate,
      "a-b",
      "a.b",
      "a b",
      "äbc",
      "élan",
      "Иван",
      "\u212Aab",
    ];

    for (const candidate of invalidCandidates) {
      expect(handleSchema.safeParse(candidate).success, `expected "${candidate}" to fail handleSchema`).toBe(false);
    }
  });

  it("rejects every name in reservedHandles across lowercase, uppercase, mixed case, and padded inputs", () => {
    expect(reservedHandles.length).toBe(20);

    for (const reserved of reservedHandles) {
      const variants = [reserved, reserved.toUpperCase(), alternateCase(reserved), `  ${reserved.toUpperCase()}  `];

      for (const variant of variants) {
        expect(isReservedHandle(variant), `expected isReservedHandle("${variant}") to be true`).toBe(true);
        expect(handleSchema.safeParse(variant).success, `expected handleSchema to reject reserved handle "${variant}"`).toBe(false);
      }
    }
  });

  it("keeps the OPEN (Henry): placeholder marker on both handle constants in limits.ts", () => {
    const currentDirectory = dirname(fileURLToPath(import.meta.url));
    const limitsPath = resolve(currentDirectory, "../schemas/limits.ts");
    const limitsSource = readFileSync(limitsPath, "utf8");

    expect(limitsSource).toMatch(/\/\/ OPEN \(Henry\): placeholder\s*\nexport const handleMinimumLength = \d+;/);
    expect(limitsSource).toMatch(/\/\/ OPEN \(Henry\): placeholder\s*\nexport const handleMaximumLength = \d+;/);
  });

  it("accepts null handle on userSchema until chosen and normalizes non-null handle to lowercase", () => {
    const newUser = userSchema.parse({
      id: userId,
      handle: null,
      createdAt: timestamp,
    });
    expect(newUser.handle).toBeNull();

    const namedUser = userSchema.parse({
      id: userId,
      handle: "  Grappler_42 ",
      createdAt: timestamp,
    });
    expect(namedUser.handle).toBe("grappler_42");
  });

  it("exposes no real-name field anywhere in user or handle schemas and rejects real-name fields on requests", () => {
    const schemaShapeKeyLists = [
      Object.keys(userSchema.shape),
      Object.keys(setHandleRequestSchema.shape),
      Object.keys(handleAvailabilityResponseSchema.shape),
    ];

    for (const shapeKeys of schemaShapeKeyLists) {
      for (const forbiddenKey of forbiddenRealNameKeys) {
        expect(shapeKeys).not.toContain(forbiddenKey);
      }
    }

    for (const forbiddenKey of forbiddenRealNameKeys) {
      const payloadWithRealName = {
        handle: "ab_1",
        [forbiddenKey]: "Real Person",
      };
      expect(setHandleRequestSchema.safeParse(payloadWithRealName).success).toBe(false);
    }
  });
});
