import { describe, expect, it } from "vitest";
import { deleteAccount, exportAccountData } from "../auth/accountActions";
import { createMobileAuthClient } from "../auth/authClient";
import { FAILURE_MESSAGES, verifyEmailCode } from "../auth/signInActions";
import { createFakeBackend, createMemorySecureStore, TEST_ACCOUNT_EXPORT, TEST_BACKEND_URL } from "./authTestDoubles";

async function createSignedInSession() {
  const backend = createFakeBackend();
  const secureStore = createMemorySecureStore();
  const client = createMobileAuthClient({ backendUrl: TEST_BACKEND_URL, storage: secureStore, fetchImplementation: backend.fetchImplementation });
  expect(await verifyEmailCode(client, { email: "member@example.test", code: "123456", ageConfirmed: true })).toEqual({ ok: true });
  backend.requests.length = 0;
  return { backend, secureStore, session: { client, secureStore, backendUrl: TEST_BACKEND_URL } };
}

describe("account requests (HEN-65)", () => {
  it("exports with GET /account/export and the session cookie, and returns the data as readable JSON", async () => {
    const { backend, session } = await createSignedInSession();

    const result = await exportAccountData(session);

    expect(backend.requests).toHaveLength(1);
    expect(backend.requests[0]).toMatchObject({ url: `${TEST_BACKEND_URL}/account/export`, method: "GET" });
    expect(backend.requests[0]?.cookie).toContain("signed-session-value");
    expect(result).toEqual({ ok: true, json: JSON.stringify(TEST_ACCOUNT_EXPORT, null, 2) });
  });

  it("deletes with DELETE /account and the session cookie, then removes the session from SecureStore", async () => {
    const { backend, secureStore, session } = await createSignedInSession();
    expect(secureStore.items.get("bjjroll_cookie")).toContain("signed-session-value");

    const result = await deleteAccount(session);

    expect(result).toEqual({ ok: true });
    expect(backend.requests.filter((request) => request.method === "DELETE").map((request) => request.url)).toEqual([`${TEST_BACKEND_URL}/account`]);
    expect(backend.requests[0]?.cookie).toContain("signed-session-value");
    expect(secureStore.items.has("bjjroll_cookie")).toBe(false);
    expect(secureStore.items.has("bjjroll_session_data")).toBe(false);
  });

  it("keeps the session and returns the plain no-connection message when the backend cannot be reached", async () => {
    const { backend, secureStore, session } = await createSignedInSession();
    backend.fetchImplementation.mockRejectedValue(new TypeError("Network request failed"));

    expect(await deleteAccount(session)).toEqual({ ok: false, reason: "network", message: FAILURE_MESSAGES.network });
    expect(await exportAccountData(session)).toEqual({ ok: false, reason: "network", message: FAILURE_MESSAGES.network });
    expect(secureStore.items.get("bjjroll_cookie")).toContain("signed-session-value");
  });

  it("keeps the session and shows a plain message, not the server's, when the backend refuses", async () => {
    const { backend, secureStore, session } = await createSignedInSession();
    backend.fetchImplementation.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ error: "boom: internal detail" }), { status: 500 })),
    );

    expect(await deleteAccount(session)).toEqual({ ok: false, reason: "unknown", message: FAILURE_MESSAGES.unknown });
    expect(await exportAccountData(session)).toEqual({ ok: false, reason: "unknown", message: FAILURE_MESSAGES.unknown });
    expect(secureStore.items.get("bjjroll_cookie")).toContain("signed-session-value");
  });

  it("treats an export that does not match the shared schema as a failure", async () => {
    const { backend, session } = await createSignedInSession();
    backend.fetchImplementation.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ user: { id: "someone-else" } }), { status: 200, headers: { "content-type": "application/json" } }),
      ),
    );

    expect(await exportAccountData(session)).toEqual({ ok: false, reason: "unknown", message: FAILURE_MESSAGES.unknown });
  });
});
