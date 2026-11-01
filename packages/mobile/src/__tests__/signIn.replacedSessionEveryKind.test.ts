import { describe, expect, it, vi } from "vitest";
import { createMobileAuthClient } from "../auth/authClient";
import { exchangeMagicLink } from "../auth/magicLinkReturn";
import { verifyEmailCode } from "../auth/signInActions";
import { signInWithProvider, SOCIAL_SIGN_IN_CALLBACK_URL } from "../auth/socialSignIn";
import { createFakeBackend, createMemorySecureStore, seedPendingSignIn, TEST_BACKEND_URL } from "./authTestDoubles";

const OLD_SESSION_COOKIE = "better-auth.session_token=old-session-value";
const codeEntry = { email: "member@example.test", code: "123456", age16Confirmed: true, signUpAttestationAccepted: true } as const;
const age16 = { age16Confirmed: true, age18Confirmed: false, signUpAttestationAccepted: true } as const;

async function signedInWithOldSession() {
  const backend = createFakeBackend();
  const secureStore = createMemorySecureStore();
  let oldSessionSent = false;
  const fetchImplementation = (input: string | URL | Request, init?: RequestInit) => {
    if (!oldSessionSent && new Request(input).url.endsWith("/sign-in/email-otp")) {
      oldSessionSent = true;
      return Promise.resolve(Response.json({ token: "old", user: { id: "user-1" } }, { headers: { "set-cookie": `${OLD_SESSION_COOKIE}; Path=/` } }));
    }
    return backend.fetchImplementation(input, init);
  };
  const client = createMobileAuthClient({ backendUrl: TEST_BACKEND_URL, storage: secureStore, fetchImplementation });
  expect(await verifyEmailCode(client, codeEntry, secureStore)).toEqual({ ok: true });
  expect(secureStore.items.get("bjjroll_pending_sign_out")).toBeUndefined();
  const dependencies = {
    client,
    secureStore,
    backendUrl: TEST_BACKEND_URL,
    platform: "ios",
    browser: { openAuthSessionAsync: vi.fn(() => Promise.resolve({ type: "success", url: `${SOCIAL_SIGN_IN_CALLBACK_URL}?code=one-time-code` })) },
    appleNative: {
      signInAsync: vi.fn(() => Promise.resolve({ identityToken: "apple-identity-token", authorizationCode: null })),
      createNonce: () => "raw-nonce-0123456789abcdef",
      sha256Hex: () => Promise.resolve("ab".repeat(32)),
    },
  };
  return { client, secureStore, dependencies };
}

type Signed = Awaited<ReturnType<typeof signedInWithOldSession>>;

const signInKinds: readonly (readonly [string, (signed: Signed) => Promise<unknown>])[] = [
  [
    "a magic link",
    async ({ client, secureStore }) => {
      seedPendingSignIn(secureStore);
      return await exchangeMagicLink(client, secureStore, {
        url: "bjjroll://auth?code=exchange-code-1",
        signal: new AbortController().signal,
        signedOut: new AbortController().signal,
      });
    },
  ],
  ["Google", async ({ dependencies }) => await signInWithProvider(dependencies, "google", age16)],
  ["an email code", async ({ client, secureStore }) => await verifyEmailCode(client, codeEntry, secureStore)],
  ["Apple", async ({ dependencies }) => await signInWithProvider(dependencies, "apple", age16)],
];

describe("every kind of sign-in over an existing session queues the old session to be ended", () => {
  it.each(signInKinds)("signing in with %s queues the old session for sign-out and keeps the new one", async (_kind, signIn) => {
    const signed = await signedInWithOldSession();

    expect(await signIn(signed)).toEqual({ ok: true });

    expect(signed.secureStore.items.get("bjjroll_pending_sign_out")).toContain(OLD_SESSION_COOKIE);
    expect(signed.secureStore.items.get("bjjroll_cookie")).toContain("signed-session-value");
  });
});
