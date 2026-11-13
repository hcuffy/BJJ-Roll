import { describe, expect, it } from "vitest";
import { createMobileAuthClient } from "../auth/authClient";
import { signOutOnPhone } from "../auth/signInActions";
import { createFakeBackend, createMemorySecureStore, PENDING_SIGN_IN_KEY, seedPendingSignIn, TEST_BACKEND_URL } from "./authTestDoubles";

function phone() {
  const secureStore = createMemorySecureStore();
  const client = createMobileAuthClient({
    backendUrl: TEST_BACKEND_URL,
    storage: secureStore,
    fetchImplementation: createFakeBackend().fetchImplementation,
  });
  seedPendingSignIn(secureStore);
  return { secureStore, client };
}

describe("sign-out on the phone reports session keys deleted from the session keys alone", () => {
  it("a failed delete of only the pending sign-in key still reports the keys as deleted", async () => {
    const { secureStore, client } = phone();
    secureStore.failingKeys.add(PENDING_SIGN_IN_KEY);

    const signedOut = await signOutOnPhone(client, secureStore);

    expect(signedOut.keysDeleted).toBe(true);
  });

  it("the pending sign-in key is still deleted when it can be", async () => {
    const { secureStore, client } = phone();

    const signedOut = await signOutOnPhone(client, secureStore);

    expect(signedOut.keysDeleted).toBe(true);
    expect(secureStore.items.has(PENDING_SIGN_IN_KEY)).toBe(false);
  });

  it("a failed session key delete still reports the keys as not deleted", async () => {
    const { secureStore, client } = phone();
    secureStore.failingKeys.add("bjjroll_cookie");

    const signedOut = await signOutOnPhone(client, secureStore);

    expect(signedOut.keysDeleted).toBe(false);
  });
});
