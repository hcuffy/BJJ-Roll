import { describe, expect, it } from "vitest";
import { AGE_CONFIRMATION_LABEL, AGE_REQUIRED_MESSAGE, canContinue } from "../auth/ageConfirmation";
import { createMobileAuthClient } from "../auth/authClient";
import { sendEmailCode, sendMagicLink } from "../auth/signInActions";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL } from "./authTestDoubles";

describe("age confirmation gate", () => {
  it("labels the checkbox for 17 or older", () => {
    expect(AGE_CONFIRMATION_LABEL).toBe("I am 17 or older");
  });

  it("keeps Continue disabled until the box is ticked and an email is entered", () => {
    expect(canContinue({ email: "member@example.test", ageConfirmed: false })).toBe(false);
    expect(canContinue({ email: "", ageConfirmed: true })).toBe(false);
    expect(canContinue({ email: "not-an-email", ageConfirmed: true })).toBe(false);
    expect(canContinue({ email: " member@example.test ", ageConfirmed: true })).toBe(true);
  });

  it("sends no request for a code or a link without the box ticked", async () => {
    const backend = createFakeBackend();
    const client = createMobileAuthClient({
      backendUrl: TEST_BACKEND_URL,
      storage: createMemorySecureStore(),
      fetchImplementation: backend.fetchImplementation,
    });

    const codeResult = await sendEmailCode(client, { email: "member@example.test", ageConfirmed: false });
    const linkResult = await sendMagicLink(client, { email: "member@example.test", ageConfirmed: false });

    expect(codeResult).toEqual({ ok: false, message: AGE_REQUIRED_MESSAGE });
    expect(linkResult).toEqual({ ok: false, message: AGE_REQUIRED_MESSAGE });
    expect(backend.fetchImplementation).not.toHaveBeenCalled();
  });
});
