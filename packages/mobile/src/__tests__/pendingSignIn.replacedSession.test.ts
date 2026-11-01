import { describe, expect, it } from "vitest";
import { createMobileAuthClient } from "../auth/authClient";
import { exchangeForPendingSignIn } from "../auth/pendingSignIn";
import { completeMagicLink } from "../auth/magicLinkReturn";
import { verifyEmailCode } from "../auth/signInActions";
import { createFakeBackend, createMemorySecureStore, seedPendingSignIn, TEST_BACKEND_URL } from "./authTestDoubles";

const OLD_SESSION_COOKIE = "better-auth.session_token=old-session-value";

describe("a sign-in link that replaces a session queues the old one to be ended (A1)", () => {
  it("the old session cookie goes on the pending sign-out queue", async () => {
    const backend = createFakeBackend();
    const secureStore = createMemorySecureStore();
    const fetchImplementation = (input: string | URL | Request, init?: RequestInit) =>
      new URL(input instanceof Request ? input.url : input).pathname.endsWith("/sign-in/email-otp")
        ? Promise.resolve(Response.json({ token: "old", user: { id: "user-1" } }, { headers: { "set-cookie": `${OLD_SESSION_COOKIE}; Path=/` } }))
        : backend.fetchImplementation(input, init);
    const client = createMobileAuthClient({ backendUrl: TEST_BACKEND_URL, storage: secureStore, fetchImplementation });
    await verifyEmailCode(client, { email: "member@example.test", code: "123456", age16Confirmed: true, signUpAttestationAccepted: true });
    seedPendingSignIn(secureStore);

    const result = await exchangeForPendingSignIn(client, secureStore, (verifier) =>
      completeMagicLink(client, "bjjroll://auth?code=exchange-code-1", { verifier }),
    );

    expect(result).toEqual({ ok: true });
    expect(secureStore.items.get("bjjroll_pending_sign_out")).toContain(OLD_SESSION_COOKIE);
    expect(secureStore.items.get("bjjroll_cookie")).toContain("signed-session-value");
  });

  it("without a sign-in started on this phone nothing is exchanged", async () => {
    const backend = createFakeBackend();
    const secureStore = createMemorySecureStore();
    const client = createMobileAuthClient({ backendUrl: TEST_BACKEND_URL, storage: secureStore, fetchImplementation: backend.fetchImplementation });

    const result = await exchangeForPendingSignIn(client, secureStore, (verifier) =>
      completeMagicLink(client, "bjjroll://auth?r=link_invalid", { verifier }),
    );

    expect(result).toEqual({ ok: false, reason: "ignored", message: null });
    expect(backend.requests).toEqual([]);
  });
});
