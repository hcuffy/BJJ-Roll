import { describe, expect, it } from "vitest";
import { createMobileAuthClient } from "../auth/authClient";
import { readSignedInUserId, signOut, verifyEmailCode } from "../auth/signInActions";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL } from "./authTestDoubles";

const COOKIE_STORAGE_KEY = "bjjroll_cookie";

describe("session storage", () => {
  it("keeps the session cookie in SecureStore, sends it back, and clears it on sign-out", async () => {
    const backend = createFakeBackend();
    const secureStore = createMemorySecureStore();
    const options = { backendUrl: TEST_BACKEND_URL, storage: secureStore, fetchImplementation: backend.fetchImplementation };
    const client = createMobileAuthClient(options);

    expect(await verifyEmailCode(client, { email: "member@example.test", code: "123456", ageConfirmed: true })).toEqual({ ok: true });
    expect(secureStore.items.get(COOKIE_STORAGE_KEY)).toContain("signed-session-value");

    const restartedClient = createMobileAuthClient(options);
    expect(await readSignedInUserId(restartedClient)).toBe("user-1");
    expect(backend.requests.at(-1)?.cookie).toContain("better-auth.session_token=signed-session-value");

    await signOut(restartedClient);
    expect(backend.requests.at(-1)?.url).toBe(`${TEST_BACKEND_URL}/api/auth/sign-out`);
    for (const storedValue of secureStore.items.values()) {
      expect(storedValue).not.toContain("signed-session-value");
    }

    const clientAfterSignOut = createMobileAuthClient(options);
    expect(await readSignedInUserId(clientAfterSignOut)).toBeNull();
    expect(backend.requests.at(-1)?.cookie ?? "").not.toContain("session_token");
  });
});
