import { describe, expect, it, vi } from "vitest";
import { createMobileAuthClient } from "../auth/authClient";
import { signOut, verifyEmailCode } from "../auth/signInActions";
import { signInWithProvider, SOCIAL_SIGN_IN_CALLBACK_URL } from "../auth/socialSignIn";
import { createFakeBackend, createMemorySecureStore, PENDING_SIGN_IN_KEY, seedPendingSignIn, TEST_BACKEND_URL } from "./authTestDoubles";

const age16 = { age16Confirmed: true, age18Confirmed: false, signUpAttestationAccepted: true } as const;

function phoneWithPendingLink(platform = "android") {
  const backend = createFakeBackend();
  const secureStore = createMemorySecureStore();
  const client = createMobileAuthClient({ backendUrl: TEST_BACKEND_URL, storage: secureStore, fetchImplementation: backend.fetchImplementation });
  seedPendingSignIn(secureStore);
  const appleNative = {
    signInAsync: vi.fn(() => Promise.resolve({ identityToken: "fake.identity.token", authorizationCode: "fake-apple-code" })),
    createNonce: () => "raw-nonce-0123456789abcdef",
    sha256Hex: () => Promise.resolve("ab".repeat(32)),
  };
  const browser = {
    openAuthSessionAsync: vi.fn(() => Promise.resolve({ type: "success", url: `${SOCIAL_SIGN_IN_CALLBACK_URL}?code=one-time-code` })),
  };
  const dependencies = { client, secureStore, backendUrl: TEST_BACKEND_URL, platform, browser, appleNative };
  return { client, secureStore, dependencies };
}

describe("an older emailed link stops working once the phone signs in another way or signs out (Sara scope 4)", () => {
  it("signing in with the email code clears the pending link", async () => {
    const { client, secureStore } = phoneWithPendingLink();
    const entry = { email: "member@example.test", code: "123456", ...age16 };
    expect(await verifyEmailCode(client, entry, secureStore)).toEqual({ ok: true });
    expect(secureStore.items.has(PENDING_SIGN_IN_KEY)).toBe(false);
  });

  it("a code that is not 6 digits signs nobody in and keeps the pending link", async () => {
    const { client, secureStore } = phoneWithPendingLink();
    const entry = { email: "member@example.test", code: "12", ...age16 };
    expect(await verifyEmailCode(client, entry, secureStore)).toMatchObject({ ok: false, reason: "invalidCode" });
    expect(secureStore.items.has(PENDING_SIGN_IN_KEY)).toBe(true);
  });

  it("signing in with Google clears the pending link", async () => {
    const { secureStore, dependencies } = phoneWithPendingLink();
    expect(await signInWithProvider(dependencies, "google", age16)).toEqual({ ok: true });
    expect(secureStore.items.has(PENDING_SIGN_IN_KEY)).toBe(false);
  });

  it("signing in with Apple clears the pending link", async () => {
    const { secureStore, dependencies } = phoneWithPendingLink("ios");
    expect(await signInWithProvider(dependencies, "apple", age16)).toEqual({ ok: true });
    expect(secureStore.items.get("bjjroll_cookie")).toContain("signed-session-value");
    expect(secureStore.items.has(PENDING_SIGN_IN_KEY)).toBe(false);
  });

  it("signing out clears the pending link", async () => {
    const { client, secureStore } = phoneWithPendingLink();
    await signOut(client, secureStore);
    expect(secureStore.items.has(PENDING_SIGN_IN_KEY)).toBe(false);
  });
});
