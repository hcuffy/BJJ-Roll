import { describe, expect, it } from "vitest";
import { AGE_GATE_REFUSAL_MESSAGE, ageConfirmedSchema, signUpRequestSchema } from "../index.js";

describe("sign-up request schema (HEN-77 age gate)", () => {
  it("accepts a sign-up request with ageConfirmed true", () => {
    expect(signUpRequestSchema.safeParse({ email: "new.member@example.com", ageConfirmed: true }).success).toBe(true);
  });

  it.each([
    { name: "missing", request: { email: "new.member@example.com" } },
    { name: "false", request: { email: "new.member@example.com", ageConfirmed: false } },
    { name: "the string true", request: { email: "new.member@example.com", ageConfirmed: "true" } },
    { name: "the number 1", request: { email: "new.member@example.com", ageConfirmed: 1 } },
  ])("rejects ageConfirmed $name with the age gate message", ({ request }) => {
    const result = signUpRequestSchema.safeParse(request);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toContain(AGE_GATE_REFUSAL_MESSAGE);
  });

  it("uses the exact user-facing refusal message", () => {
    expect(AGE_GATE_REFUSAL_MESSAGE).toBe("You must be 17 or older to use BJJ Roll.");
  });

  it("ageConfirmedSchema accepts only the literal true", () => {
    expect(ageConfirmedSchema.safeParse(true).success).toBe(true);
    expect(ageConfirmedSchema.safeParse(false).success).toBe(false);
    expect(ageConfirmedSchema.safeParse(undefined).success).toBe(false);
  });
});
