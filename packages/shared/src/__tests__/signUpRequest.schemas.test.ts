import { describe, expect, it } from "vitest";
import { AGE_GATE_REFUSAL_MESSAGE, age16ConfirmedSchema, MINIMUM_SIGN_UP_AGE, signUpRequestSchema } from "../index.js";

describe("sign-up request schema (HEN-77 age gate, 16+ since HEN-263)", () => {
  it("accepts a sign-up request with age16Confirmed true and no 18+ answer", () => {
    expect(signUpRequestSchema.safeParse({ email: "new.member@example.com", age16Confirmed: true }).success).toBe(true);
  });

  it.each([true, false])("accepts the optional 18+ answer %s", (age18Confirmed) => {
    expect(signUpRequestSchema.safeParse({ email: "new.member@example.com", age16Confirmed: true, age18Confirmed }).success).toBe(true);
  });

  it("rejects an 18+ answer that is not a boolean", () => {
    expect(signUpRequestSchema.safeParse({ email: "new.member@example.com", age16Confirmed: true, age18Confirmed: "true" }).success).toBe(false);
  });

  it.each([
    { name: "missing", request: { email: "new.member@example.com" } },
    { name: "false", request: { email: "new.member@example.com", age16Confirmed: false } },
    { name: "the string true", request: { email: "new.member@example.com", age16Confirmed: "true" } },
    { name: "the number 1", request: { email: "new.member@example.com", age16Confirmed: 1 } },
  ])("rejects age16Confirmed $name with the age gate message", ({ request }) => {
    const result = signUpRequestSchema.safeParse(request);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toContain(AGE_GATE_REFUSAL_MESSAGE);
  });

  it("uses the exact 16+ user-facing refusal message and minimum age (HEN-263)", () => {
    expect(AGE_GATE_REFUSAL_MESSAGE).toBe("You must be 16 or older to sign up.");
    expect(MINIMUM_SIGN_UP_AGE).toBe(16);
  });

  it("age16ConfirmedSchema accepts only the literal true", () => {
    expect(age16ConfirmedSchema.safeParse(true).success).toBe(true);
    expect(age16ConfirmedSchema.safeParse(false).success).toBe(false);
    expect(age16ConfirmedSchema.safeParse(undefined).success).toBe(false);
  });
});
