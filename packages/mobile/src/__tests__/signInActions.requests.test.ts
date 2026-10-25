import { describe, expect, it } from "vitest";
import { createMobileAuthClient } from "../auth/authClient";
import { completeMagicLink, sendEmailCode, sendMagicLink, verifyEmailCode } from "../auth/signInActions";
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
  it("asks for a 6-digit sign-in code with ageConfirmed true", async () => {
    const { backend, client } = createTestClient();

    const result = await sendEmailCode(client, { email: " Member@Example.test ", ageConfirmed: true });

    expect(result).toEqual({ ok: true });
    expect(backend.requests).toHaveLength(1);
    expect(backend.requests[0]?.url).toBe(`${TEST_BACKEND_URL}/api/auth/email-otp/send-verification-otp`);
    expect(backend.requests[0]?.body).toEqual({ email: "Member@Example.test", type: "sign-in", ageConfirmed: true });
  });

  it("signs in with the code and ageConfirmed true", async () => {
    const { backend, client } = createTestClient();

    const result = await verifyEmailCode(client, { email: "member@example.test", code: " 123456 ", ageConfirmed: true });

    expect(result).toEqual({ ok: true });
    expect(backend.requests[0]?.url).toBe(`${TEST_BACKEND_URL}/api/auth/sign-in/email-otp`);
    expect(backend.requests[0]?.body).toEqual({ email: "member@example.test", otp: "123456", ageConfirmed: true });
  });

  it("rejects a code that is not 6 digits without a request", async () => {
    const { backend, client } = createTestClient();

    const result = await verifyEmailCode(client, { email: "member@example.test", code: "12345", ageConfirmed: true });

    expect(result.ok).toBe(false);
    expect(backend.fetchImplementation).not.toHaveBeenCalled();
  });

  it("asks for a magic link that comes back to the bjjroll deep link", async () => {
    const { backend, client } = createTestClient();

    const result = await sendMagicLink(client, { email: "member@example.test", ageConfirmed: true });

    expect(result).toEqual({ ok: true });
    expect(backend.requests[0]?.url).toBe(`${TEST_BACKEND_URL}/api/auth/sign-in/magic-link`);
    expect(backend.requests[0]?.body).toEqual({ email: "member@example.test", callbackURL: "bjjroll://auth", ageConfirmed: true });
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

    expect(await completeMagicLink(client, "https://evil.test/auth?code=exchange-code-1")).toEqual({ ok: false, message: null });
    expect(await completeMagicLink(client, "bjjroll://other?code=exchange-code-1")).toEqual({ ok: false, message: null });
    expect(await completeMagicLink(client, "bjjroll://auth")).toEqual({ ok: false, message: null });
    expect((await completeMagicLink(client, "bjjroll://auth?error=INVALID_TOKEN")).ok).toBe(false);
    expect(backend.fetchImplementation).not.toHaveBeenCalled();
  });
});
