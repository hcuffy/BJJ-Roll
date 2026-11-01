import { describe, expect, it } from "vitest";
import { createMobileAuthClient } from "../auth/authClient";
import { exchangeMagicLink } from "../auth/magicLinkReturn";
import { readPendingSignOuts } from "../auth/pendingSignOuts";
import { signOutOnPhone } from "../auth/signInActions";
import { createFakeBackend, createMemorySecureStore, seedPendingSignIn, TEST_BACKEND_URL } from "./authTestDoubles";

const NEW_SESSION_COOKIE = "better-auth.session_token=signed-session-value";

describe("a sign-out that lands while a link exchange is finishing ends the session the server just made (Sara scope 5)", () => {
  it("the new session is queued to be ended, the phone stays signed out, and the link is ignored", async () => {
    const backend = createFakeBackend();
    const secureStore = createMemorySecureStore();
    const signedOut = new AbortController();
    const fetchImplementation = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const response = await backend.fetchImplementation(input, { ...init, signal: undefined });
      if (new URL(input instanceof Request ? input.url : input).pathname.endsWith("/magic-link/exchange")) {
        signedOut.abort();
        await signOutOnPhone(client, secureStore);
      }
      return response;
    };
    const client = createMobileAuthClient({ backendUrl: TEST_BACKEND_URL, storage: secureStore, fetchImplementation });
    seedPendingSignIn(secureStore);

    const result = await exchangeMagicLink(client, secureStore, {
      url: "bjjroll://auth?code=exchange-code-1",
      signal: new AbortController().signal,
      signedOut: signedOut.signal,
    });

    expect(result).toEqual({ ok: false, reason: "ignored", message: null });
    expect(secureStore.items.has("bjjroll_cookie")).toBe(false);
    expect((await readPendingSignOuts(secureStore))?.some((marker) => marker.startsWith(NEW_SESSION_COOKIE))).toBe(true);
  });
});
