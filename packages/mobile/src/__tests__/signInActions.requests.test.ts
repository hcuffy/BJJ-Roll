import { AGE_GATE_REFUSAL_MESSAGE } from "@bjj-roll/shared";
import { describe, expect, it } from "vitest";
import { createMobileAuthClient } from "../auth/authClient";
import { completeMagicLink, FAILURE_MESSAGES, sendEmailCode, sendMagicLink, verifyEmailCode } from "../auth/signInActions";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL } from "./authTestDoubles";

function createTestClient() {
  const backend = createFakeBackend();
  const client = createMobileAuthClient({
    backendUrl: TEST_BACKEND_URL,
    storage: createMemorySecureStore(),
    fetchImplementation: backend.fetchImplementation,
  });
  return { backend, client };
}

describe("sign-in requests", () => {
  it("asks for a 6-digit sign-in code with age16Confirmed true", async () => {
    const { backend, client } = createTestClient();

    const result = await sendEmailCode(client, { email: " Member@Example.test ", age16Confirmed: true });

    expect(result).toEqual({ ok: true });
    expect(backend.requests).toHaveLength(1);
    expect(backend.requests[0]?.url).toBe(`${TEST_BACKEND_URL}/api/auth/email-otp/send-verification-otp`);
    expect(backend.requests[0]?.body).toEqual({ email: "Member@Example.test", type: "sign-in", age16Confirmed: true, age18Confirmed: false });
  });

  it("signs in with the code and age16Confirmed true", async () => {
    const { backend, client } = createTestClient();

    const result = await verifyEmailCode(client, { email: "member@example.test", code: " 123456 ", age16Confirmed: true });

    expect(result).toEqual({ ok: true });
    expect(backend.requests[0]?.url).toBe(`${TEST_BACKEND_URL}/api/auth/sign-in/email-otp`);
    expect(backend.requests[0]?.body).toEqual({ email: "member@example.test", otp: "123456", age16Confirmed: true });
  });

  it("rejects a code that is not 6 digits without a request", async () => {
    const { backend, client } = createTestClient();

    const result = await verifyEmailCode(client, { email: "member@example.test", code: "12345", age16Confirmed: true });

    expect(result.ok).toBe(false);
    expect(backend.fetchImplementation).not.toHaveBeenCalled();
  });

  it("asks for a magic link that comes back to the bjjroll deep link", async () => {
    const { backend, client } = createTestClient();

    const result = await sendMagicLink(client, { email: "member@example.test", age16Confirmed: true });

    expect(result).toEqual({ ok: true });
    expect(backend.requests[0]?.url).toBe(`${TEST_BACKEND_URL}/api/auth/sign-in/magic-link`);
    expect(backend.requests[0]?.body).toEqual({
      email: "member@example.test",
      callbackURL: "bjjroll://auth",
      age16Confirmed: true,
      age18Confirmed: false,
    });
  });

  it("passes the optional 18+ answer on with both sends, as a plain boolean (HEN-263)", async () => {
    const { backend, client } = createTestClient();

    await sendEmailCode(client, { email: "member@example.test", age16Confirmed: true, age18Confirmed: true });
    await sendMagicLink(client, { email: "member@example.test", age16Confirmed: true, age18Confirmed: true });

    expect(backend.requests.map((request) => request.body?.age18Confirmed)).toEqual([true, true]);
  });

  it("shows the 16+ refusal, not the invalid-link copy, when a link comes back with r=age_refused (HEN-263)", async () => {
    const { client } = createTestClient();
    expect(await completeMagicLink(client, "bjjroll://auth?r=age_refused")).toEqual({
      ok: false,
      reason: "ageRequired",
      message: AGE_GATE_REFUSAL_MESSAGE,
    });
  });

  it("maps r=link_invalid to the app's invalid-link copy (HEN-263)", async () => {
    const { client } = createTestClient();
    expect(await completeMagicLink(client, "bjjroll://auth?r=link_invalid")).toEqual({
      ok: false,
      reason: "invalidLink",
      message: FAILURE_MESSAGES.invalidLink,
    });
  });

  it.each([
    "bjjroll://auth?r=something_new",
    "bjjroll://auth?r=age_refused%20extra",
    "bjjroll://auth?error=AGE_CONFIRMATION_REQUIRED&error_description=You%20must%20be%2016",
  ])("shows only the generic error for an unknown reason code or a legacy error param, never URL text: %s", async (url) => {
    const { backend, client } = createTestClient();
    const result = await completeMagicLink(client, url);
    expect(result).toEqual({ ok: false, reason: "unknown", message: FAILURE_MESSAGES.unknown });
    expect(backend.fetchImplementation).not.toHaveBeenCalled();
  });

  it("exchanges the code from a bjjroll://auth deep link for a session", async () => {
    const { backend, client } = createTestClient();

    const result = await completeMagicLink(client, "bjjroll://auth?code=exchange-code-1");

    expect(result).toEqual({ ok: true });
    expect(backend.requests[0]?.url).toBe(`${TEST_BACKEND_URL}/api/auth/magic-link/exchange`);
    expect(backend.requests[0]?.body).toEqual({ code: "exchange-code-1" });
  });

  it("ignores links that are not bjjroll://auth or carry no code", async () => {
    const { backend, client } = createTestClient();

    expect(await completeMagicLink(client, "https://evil.test/auth?code=exchange-code-1")).toEqual({ ok: false, reason: "ignored", message: null });
    expect(await completeMagicLink(client, "bjjroll://other?code=exchange-code-1")).toEqual({ ok: false, reason: "ignored", message: null });
    expect(await completeMagicLink(client, "bjjroll://auth")).toEqual({ ok: false, reason: "ignored", message: null });
    expect((await completeMagicLink(client, "bjjroll://auth?r=link_invalid")).ok).toBe(false);
    expect(backend.fetchImplementation).not.toHaveBeenCalled();
  });

  it("turns the backend's 400 AGE_CONFIRMATION_REQUIRED into the shared 16+ refusal message", async () => {
    const { backend, client } = createTestClient();
    backend.fetchImplementation.mockImplementation(() =>
      Promise.resolve(Response.json({ code: "AGE_CONFIRMATION_REQUIRED", message: "server wording" }, { status: 400 })),
    );

    expect(await sendEmailCode(client, { email: "member@example.test", age16Confirmed: true })).toEqual({
      ok: false,
      reason: "ageRequired",
      message: AGE_GATE_REFUSAL_MESSAGE,
    });
    expect(await sendMagicLink(client, { email: "member@example.test", age16Confirmed: true })).toEqual({
      ok: false,
      reason: "ageRequired",
      message: AGE_GATE_REFUSAL_MESSAGE,
    });
  });

  it("maps a wrong, expired or used-up code to plain copy instead of the server text", async () => {
    for (const code of ["INVALID_OTP", "OTP_EXPIRED", "TOO_MANY_ATTEMPTS"]) {
      const { backend, client } = createTestClient();
      backend.fetchImplementation.mockImplementation(() => Promise.resolve(Response.json({ code, message: "Invalid OTP" }, { status: 400 })));

      expect(await verifyEmailCode(client, { email: "member@example.test", code: "123456", age16Confirmed: true })).toEqual({
        ok: false,
        reason: "invalidCode",
        message: "That code didn't work. Check the email or send a new code.",
      });
    }
  });

  it("maps a failed link exchange (used or expired code) to the invalid-link copy", async () => {
    const { backend, client } = createTestClient();
    backend.fetchImplementation.mockImplementation(() =>
      Promise.resolve(Response.json({ code: "INVALID_TOKEN", message: "Invalid token" }, { status: 401 })),
    );
    expect(await completeMagicLink(client, "bjjroll://auth?code=used-code")).toEqual({
      ok: false,
      reason: "invalidLink",
      message: "This sign-in link has expired or was already used. Send a new one.",
    });
  });

  it("maps a network failure and a rate limit to plain copy", async () => {
    const offline = createTestClient();
    offline.backend.fetchImplementation.mockRejectedValue(new TypeError("Network request failed"));
    expect(await sendEmailCode(offline.client, { email: "member@example.test", age16Confirmed: true })).toEqual({
      ok: false,
      reason: "network",
      message: "No connection. Check your internet and try again.",
    });

    const limited = createTestClient();
    limited.backend.fetchImplementation.mockImplementation(() =>
      Promise.resolve(Response.json({ code: "TOO_MANY_REQUESTS", message: "Too many verification emails requested" }, { status: 429 })),
    );
    expect(await sendMagicLink(limited.client, { email: "member@example.test", age16Confirmed: true })).toEqual({
      ok: false,
      reason: "rateLimited",
      message: "Too many tries. Wait a minute and try again.",
    });
  });

  it("never shows a raw server message: unknown failures get the generic fallback", async () => {
    const { backend, client } = createTestClient();
    backend.fetchImplementation.mockImplementation(() =>
      Promise.resolve(Response.json({ code: "INTERNAL", message: "relation users does not exist" }, { status: 500 })),
    );
    expect(await sendEmailCode(client, { email: "member@example.test", age16Confirmed: true })).toEqual({
      ok: false,
      reason: "unknown",
      message: "Something went wrong. Please try again.",
    });
  });
});
