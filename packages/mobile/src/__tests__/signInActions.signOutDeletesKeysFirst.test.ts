import { describe, expect, it, vi } from "vitest";
import { createMobileAuthClient } from "../auth/authClient";
import { signOut, verifyEmailCode } from "../auth/signInActions";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL } from "./authTestDoubles";

describe("sign-out deletes the phone's keys before it calls the server (M8, D31)", () => {
  it("the first sign-out request starts only after both session keys are gone", async () => {
    const backend = createFakeBackend();
    const secureStore = createMemorySecureStore();
    const calls: string[] = [];
    const fetchImplementation = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      calls.push(`fetch ${new URL(input instanceof Request ? input.url : input).pathname}`);
      return backend.fetchImplementation(input, init);
    });
    const client = createMobileAuthClient({ backendUrl: TEST_BACKEND_URL, storage: secureStore, fetchImplementation });
    await verifyEmailCode(client, { email: "member@example.test", code: "123456", age16Confirmed: true, signUpAttestationAccepted: true });
    secureStore.deleteItemAsync.mockImplementation((key: string) => {
      calls.push(`delete ${key}`);
      secureStore.items.delete(key);
      return Promise.resolve();
    });
    calls.length = 0;

    await signOut(client, secureStore);

    const firstRequest = calls.findIndex((call) => call.startsWith("fetch "));
    expect(firstRequest).toBeGreaterThan(-1);
    expect(calls.slice(0, firstRequest)).toEqual(expect.arrayContaining(["delete bjjroll_cookie", "delete bjjroll_session_data"]));
    expect(calls[firstRequest]).toBe("fetch /api/auth/sign-out");
  });
});
