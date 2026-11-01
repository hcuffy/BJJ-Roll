import { describe, expect, it } from "vitest";
import { createMobileAuthClient } from "../auth/authClient";
import { completeMagicLink } from "../auth/magicLinkReturn";
import { exchangeForPendingSignIn } from "../auth/pendingSignIn";
import { currentMs } from "../dates";
import { createFakeBackend, createMemorySecureStore, PENDING_SIGN_IN_KEY, TEST_BACKEND_URL, TEST_SIGN_IN_VERIFIER } from "./authTestDoubles";

const MINUTE_MS = 60 * 1000;

async function openLinkStartedAgo(ageMs: number) {
  const backend = createFakeBackend();
  const secureStore = createMemorySecureStore();
  const client = createMobileAuthClient({ backendUrl: TEST_BACKEND_URL, storage: secureStore, fetchImplementation: backend.fetchImplementation });
  secureStore.setItem(PENDING_SIGN_IN_KEY, JSON.stringify({ verifier: TEST_SIGN_IN_VERIFIER, startedAt: currentMs() - ageMs }));
  const result = await exchangeForPendingSignIn(client, secureStore, (verifier) =>
    completeMagicLink(client, "bjjroll://auth?code=exchange-code-1", { verifier }),
  );
  return { result, backend, secureStore };
}

describe("a sign-in started on this phone only counts for 15 minutes (Bill gate nit 2)", () => {
  it("a link opened 14 minutes after sending signs in with the phone's verifier", async () => {
    const { result, backend, secureStore } = await openLinkStartedAgo(14 * MINUTE_MS);
    expect(result).toEqual({ ok: true });
    expect(backend.requests.map((request) => request.body)).toEqual([{ code: "exchange-code-1", verifier: TEST_SIGN_IN_VERIFIER }]);
    expect(secureStore.items.get("bjjroll_cookie")).toContain("signed-session-value");
  });

  it("a link opened just over 15 minutes after sending is ignored and nothing reaches the server", async () => {
    const { result, backend, secureStore } = await openLinkStartedAgo(15 * MINUTE_MS + 1000);
    expect(result).toEqual({ ok: false, reason: "ignored", message: null });
    expect(backend.requests).toEqual([]);
    expect(secureStore.items.has("bjjroll_cookie")).toBe(false);
  });

  it("a sign-in dated in the future is ignored too", async () => {
    const { result, backend } = await openLinkStartedAgo(-MINUTE_MS);
    expect(result).toEqual({ ok: false, reason: "ignored", message: null });
    expect(backend.requests).toEqual([]);
  });
});
