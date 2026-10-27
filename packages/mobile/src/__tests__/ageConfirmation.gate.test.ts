import { AGE18_CONFIRMATION_LABEL, AGE_GATE_REFUSAL_MESSAGE } from "@bjj-roll/shared";
import { describe, expect, it } from "vitest";
import { AGE_ADULT_CONFIRMATION_LABEL, AGE_CONFIRMATION_LABEL, canContinue } from "../auth/ageConfirmation";
import { createMobileAuthClient } from "../auth/authClient";
import { sendEmailCode, sendMagicLink } from "../auth/signInActions";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL } from "./authTestDoubles";

describe("age confirmation gate", () => {
  it("labels the required checkbox for 16 or older, and the optional one from the shared 18+ label (HEN-263)", () => {
    expect(AGE_CONFIRMATION_LABEL).toBe("I am 16 or older");
    expect(AGE_ADULT_CONFIRMATION_LABEL).toBe("I am 18 or older");
    expect(AGE_ADULT_CONFIRMATION_LABEL).toBe(AGE18_CONFIRMATION_LABEL);
  });

  it("keeps Continue disabled until the box is ticked and an email is entered", () => {
    expect(canContinue({ email: "member@example.test", age16Confirmed: false })).toBe(false);
    expect(canContinue({ email: "", age16Confirmed: true })).toBe(false);
    expect(canContinue({ email: "not-an-email", age16Confirmed: true })).toBe(false);
    expect(canContinue({ email: " member@example.test ", age16Confirmed: true })).toBe(true);
    // The 18+ box is optional and never stands in for the required 16+ one.
    expect(canContinue({ email: "member@example.test", age16Confirmed: false, age18Confirmed: true })).toBe(false);
  });

  it("sends no request for a code or a link without the box ticked", async () => {
    const backend = createFakeBackend();
    const client = createMobileAuthClient({
      backendUrl: TEST_BACKEND_URL,
      storage: createMemorySecureStore(),
      fetchImplementation: backend.fetchImplementation,
    });

    const codeResult = await sendEmailCode(client, { email: "member@example.test", age16Confirmed: false });
    const linkResult = await sendMagicLink(client, { email: "member@example.test", age16Confirmed: false });

    expect(codeResult).toEqual({ ok: false, reason: "ageRequired", message: AGE_GATE_REFUSAL_MESSAGE });
    expect(linkResult).toEqual({ ok: false, reason: "ageRequired", message: AGE_GATE_REFUSAL_MESSAGE });
    expect(backend.fetchImplementation).not.toHaveBeenCalled();
  });
});
