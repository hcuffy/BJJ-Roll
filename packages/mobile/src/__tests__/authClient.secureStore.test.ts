import { describe, expect, it } from "vitest";
import { createMobileAuthClient } from "../auth/authClient";
import { readSignedInUserId, signOut, verifyEmailCode } from "../auth/signInActions";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL } from "./authTestDoubles";

const COOKIE_STORAGE_KEY = "bjjroll_cookie";
const SESSION_DATA_STORAGE_KEY = "bjjroll_session_data";

describe("session storage", () => {
  it("keeps the session cookie in SecureStore, sends it back, and clears it on sign-out", async () => {
    const backend = createFakeBackend();
    const secureStore = createMemorySecureStore();
    const options = { backendUrl: TEST_BACKEND_URL, storage: secureStore, fetchImplementation: backend.fetchImplementation };
    const client = createMobileAuthClient(options);

    expect(await verifyEmailCode(client, { email: "member@example.test", code: "123456", age16Confirmed: true })).toEqual({ ok: true });
    expect(secureStore.items.get(COOKIE_STORAGE_KEY)).toContain("signed-session-value");

    const restartedClient = createMobileAuthClient(options);
    expect(await readSignedInUserId(restartedClient)).toBe("user-1");
    expect(backend.requests.at(-1)?.cookie).toContain("better-auth.session_token=signed-session-value");
    // The session cookie is the only thing kept: no cached session data in SecureStore.
    expect([...secureStore.items.keys()]).toEqual([COOKIE_STORAGE_KEY]);

    await signOut(restartedClient, secureStore);
    expect(backend.requests.at(-1)?.url).toBe(`${TEST_BACKEND_URL}/api/auth/sign-out`);
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith(COOKIE_STORAGE_KEY);
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith(SESSION_DATA_STORAGE_KEY);
    expect(secureStore.items.has(COOKIE_STORAGE_KEY)).toBe(false);
    expect(secureStore.items.has(SESSION_DATA_STORAGE_KEY)).toBe(false);

    const clientAfterSignOut = createMobileAuthClient(options);
    expect(await readSignedInUserId(clientAfterSignOut)).toBeNull();
    expect(backend.requests.at(-1)?.cookie ?? "").not.toContain("session_token");
  });

  it("deletes both SecureStore keys on sign-out even when the backend cannot be reached", async () => {
    const backend = createFakeBackend();
    const secureStore = createMemorySecureStore();
    const client = createMobileAuthClient({ backendUrl: TEST_BACKEND_URL, storage: secureStore, fetchImplementation: backend.fetchImplementation });
    await verifyEmailCode(client, { email: "member@example.test", code: "123456", age16Confirmed: true });
    expect(secureStore.items.get(COOKIE_STORAGE_KEY)).toContain("signed-session-value");

    backend.fetchImplementation.mockRejectedValue(new TypeError("Network request failed"));
    await signOut(client, secureStore);

    expect(secureStore.items.has(COOKIE_STORAGE_KEY)).toBe(false);
    expect(secureStore.items.has(SESSION_DATA_STORAGE_KEY)).toBe(false);
  });
});
