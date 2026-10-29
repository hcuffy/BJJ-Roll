import { describe, expect, it } from "vitest";
import { confirmAdult, deleteAccount, exportAccountData, readAgeConfirmation, requestAccountDeletionCode } from "../auth/accountActions";
import { createMobileAuthClient } from "../auth/authClient";
import { FAILURE_MESSAGES, verifyEmailCode } from "../auth/signInActions";
import { createFakeBackend, createMemorySecureStore, TEST_ACCOUNT_EXPORT, TEST_BACKEND_URL, TEST_DELETE_CODE } from "./authTestDoubles";

async function createSignedInSession() {
  const backend = createFakeBackend();
  const secureStore = createMemorySecureStore();
  const client = createMobileAuthClient({ backendUrl: TEST_BACKEND_URL, storage: secureStore, fetchImplementation: backend.fetchImplementation });
  expect(
    await verifyEmailCode(client, { email: "member@example.test", code: "123456", age16Confirmed: true, signUpAttestationAccepted: true }),
  ).toEqual({ ok: true });
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

  it("asks for a delete code with POST /account/delete-code and the session cookie", async () => {
    const { backend, session } = await createSignedInSession();

    expect(await requestAccountDeletionCode(session)).toEqual({ ok: true });
    expect(backend.requests).toHaveLength(1);
    expect(backend.requests[0]).toMatchObject({ url: `${TEST_BACKEND_URL}/account/delete-code`, method: "POST" });
    expect(backend.requests[0]?.cookie).toContain("signed-session-value");
  });

  it("deletes with DELETE /account, the code in the body and the session cookie, then removes the session from SecureStore", async () => {
    const { backend, secureStore, session } = await createSignedInSession();
    expect(secureStore.items.get("bjjroll_cookie")).toContain("signed-session-value");

    const result = await deleteAccount(session, TEST_DELETE_CODE);

    expect(result).toEqual({ ok: true });
    expect(backend.requests.filter((request) => request.method === "DELETE").map((request) => request.url)).toEqual([`${TEST_BACKEND_URL}/account`]);
    expect(backend.requests[0]?.body).toEqual({ code: TEST_DELETE_CODE });
    expect(backend.requests[0]?.cookie).toContain("signed-session-value");
    expect(secureStore.items.has("bjjroll_cookie")).toBe(false);
    expect(secureStore.items.has("bjjroll_session_data")).toBe(false);
  });

  it("a refused code (403) is a code error and keeps the session; a refused code request (429) says to wait", async () => {
    const { backend, secureStore, session } = await createSignedInSession();

    expect(await deleteAccount(session, "000000")).toEqual({ ok: false, reason: "invalidCode", message: FAILURE_MESSAGES.invalidCode });
    expect(secureStore.items.get("bjjroll_cookie")).toContain("signed-session-value");

    backend.fetchImplementation.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ error: "Too many codes requested. Try again later." }), { status: 429 })),
    );
    expect(await requestAccountDeletionCode(session)).toEqual({ ok: false, reason: "rateLimited", message: FAILURE_MESSAGES.rateLimited });
  });

  it("keeps the session and returns the plain no-connection message when the backend cannot be reached", async () => {
    const { backend, secureStore, session } = await createSignedInSession();
    backend.fetchImplementation.mockRejectedValue(new TypeError("Network request failed"));

    expect(await requestAccountDeletionCode(session)).toEqual({ ok: false, reason: "network", message: FAILURE_MESSAGES.network });
    expect(await deleteAccount(session, TEST_DELETE_CODE)).toEqual({ ok: false, reason: "network", message: FAILURE_MESSAGES.network });
    expect(await exportAccountData(session)).toEqual({ ok: false, reason: "network", message: FAILURE_MESSAGES.network });
    expect(secureStore.items.get("bjjroll_cookie")).toContain("signed-session-value");
  });

  it("keeps the session and shows a plain message, not the server's, when the backend refuses", async () => {
    const { backend, secureStore, session } = await createSignedInSession();
    backend.fetchImplementation.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ error: "boom: internal detail" }), { status: 500 })),
    );

    expect(await requestAccountDeletionCode(session)).toEqual({ ok: false, reason: "unknown", message: FAILURE_MESSAGES.unknown });
    expect(await deleteAccount(session, TEST_DELETE_CODE)).toEqual({ ok: false, reason: "unknown", message: FAILURE_MESSAGES.unknown });
    expect(await exportAccountData(session)).toEqual({ ok: false, reason: "unknown", message: FAILURE_MESSAGES.unknown });
    expect(secureStore.items.get("bjjroll_cookie")).toContain("signed-session-value");
  });

  it("reads the age status with GET /account/age-confirmation and confirms 18+ with a POST (HEN-263)", async () => {
    const { backend, session } = await createSignedInSession();

    expect(await readAgeConfirmation(session)).toEqual({ ok: true, status: { age16Confirmed: true, age18Confirmed: false, canPurchase: false } });
    expect(await confirmAdult(session)).toEqual({ ok: true, status: { age16Confirmed: true, age18Confirmed: true, canPurchase: true } });

    expect(backend.requests.map((request) => [request.method, request.url, request.body])).toEqual([
      ["GET", `${TEST_BACKEND_URL}/account/age-confirmation`, null],
      ["POST", `${TEST_BACKEND_URL}/account/age-confirmation`, { age18Confirmed: true }],
    ]);
    expect(backend.requests.every((request) => request.cookie?.includes("signed-session-value"))).toBe(true);
  });

  it("an age status that does not match the shared schema, or a failed request, is a plain failure (HEN-263)", async () => {
    const { backend, session } = await createSignedInSession();
    backend.fetchImplementation.mockImplementationOnce(() =>
      Promise.resolve(new Response(JSON.stringify({ canPurchase: true }), { status: 200, headers: { "content-type": "application/json" } })),
    );
    expect(await readAgeConfirmation(session)).toEqual({ ok: false, reason: "unknown", message: FAILURE_MESSAGES.unknown });

    backend.fetchImplementation.mockRejectedValueOnce(new TypeError("Network request failed"));
    expect(await confirmAdult(session)).toEqual({ ok: false, reason: "network", message: FAILURE_MESSAGES.network });
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
