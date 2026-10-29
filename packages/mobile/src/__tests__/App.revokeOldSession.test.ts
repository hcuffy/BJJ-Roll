import { SIGN_UP_ATTESTATION_LABEL } from "@bjj-roll/shared";
import { inspect } from "node:util";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMobileAuthClient, type MobileAuthClient } from "../auth/authClient";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL } from "./authTestDoubles";
import { deepLinkState, renderScreen, settle } from "./screenHarness";

const appClient = vi.hoisted(() => ({ current: null as MobileAuthClient | null, store: null as ReturnType<typeof createMemorySecureStore> | null }));
vi.mock("../auth/appAuthClient", () => ({
  get appAuthClient() {
    return appClient.current;
  },
  get appSecureStore() {
    return appClient.store;
  },
  appBackendUrl: "http://backend.test",
}));

const { App } = await import("../App");

const PENDING_SIGN_OUT_KEY = "bjjroll_pending_sign_out";
const SIGN_IN_SCREEN = "Sign in to BJJ Roll";
const SIGNED_IN_SCREEN = "You are signed in";
const FAKE_BACKEND_SESSION_COOKIE = "better-auth.session_token=signed-session-value";
const SESSION_COOKIE_PATTERN = /better-auth\.session_token=([^;]+)/u;

/**
 * A server that keeps sessions: every sign-in starts a new one with its own signed cookie (`<token>.<signature>`, as Better Auth sends it).
 * Requests from a live session reach the shared fake backend as signed in; revoked or unknown sessions reach it signed out.
 */
function createSessionServer() {
  const backend = createFakeBackend();
  const liveSessions = new Set<string>();
  const revokeRequests: { readonly token: unknown; readonly fromSession: string | null }[] = [];
  const state = { signOutEndpointDown: false, revokeEndpointDown: false, revokeEndpointErrors: false };
  let signIns = 0;

  const sessionOf = (request: Request): string | null => {
    const signedValue = SESSION_COOKIE_PATTERN.exec(request.headers.get("cookie") ?? "")?.[1];
    if (!signedValue) {
      return null;
    }
    const decoded = decodeURIComponent(signedValue);
    return decoded.slice(0, decoded.lastIndexOf("."));
  };
  const json = (body: unknown, headers: Record<string, string> = {}, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

  const fetchImplementation = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const pathname = new URL(request.url).pathname;
    const session = sessionOf(request);
    const live = session !== null && liveSessions.has(session);
    if (pathname.endsWith("/sign-in/email-otp")) {
      signIns += 1;
      const token = `session-token-${String(signIns)}`;
      liveSessions.add(token);
      const signedValue = encodeURIComponent(`${token}.signature+${String(signIns)}=`);
      const cookie = `better-auth.session_token=${signedValue}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`;
      return json({ token, user: { id: "user-1" } }, { "set-cookie": cookie });
    }
    if (pathname.endsWith("/sign-out")) {
      if (state.signOutEndpointDown) {
        throw new TypeError("fetch failed");
      }
      if (session) {
        liveSessions.delete(session);
      }
      return json({ success: true });
    }
    if (pathname.endsWith("/revoke-session")) {
      const body = (await request.json()) as { token?: unknown };
      revokeRequests.push({ token: body.token, fromSession: live ? session : null });
      if (state.revokeEndpointDown) {
        throw new TypeError("fetch failed");
      }
      if (state.revokeEndpointErrors) {
        return json({ message: "Internal Server Error" }, {}, 500);
      }
      if (!live) {
        return json({ message: "Unauthorized" }, {}, 401);
      }
      if (typeof body.token === "string") {
        liveSessions.delete(body.token);
      }
      return json({ status: true });
    }
    const headers = new Headers(request.headers);
    headers.delete("cookie");
    if (live) {
      headers.set("cookie", FAKE_BACKEND_SESSION_COOKIE);
    }
    return await backend.fetchImplementation(new Request(request, { headers }));
  };
  return { state, liveSessions, revokeRequests, requests: backend.requests, fetchImplementation: vi.fn(fetchImplementation) };
}

describe("App revokes the old session when a new sign-in cancels an unfinished sign-out (HEN-299)", () => {
  let server: ReturnType<typeof createSessionServer>;
  let secureStore: ReturnType<typeof createMemorySecureStore>;
  let consoleSpies: { readonly mock: { readonly calls: readonly (readonly unknown[])[] } }[] = [];

  const launchApp = async () => {
    appClient.store = secureStore;
    appClient.current = createMobileAuthClient({
      backendUrl: TEST_BACKEND_URL,
      storage: secureStore,
      fetchImplementation: server.fetchImplementation,
    });
    return await renderScreen(createElement(App));
  };
  const signIn = async (screen: Awaited<ReturnType<typeof launchApp>>) => {
    await screen.pressRole("checkbox");
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    await screen.changeText("Email", "member@example.test");
    await screen.press("Continue with email");
    await screen.changeText("6-digit code", "123456");
    expect(screen.text()).toContain(SIGNED_IN_SCREEN);
  };
  /** Signed in as session 1, then sign-out cannot reach the server: the phone forgets the session, the server still has it. */
  const signOutLeftUnfinished = async () => {
    const screen = await launchApp();
    await signIn(screen);
    server.state.signOutEndpointDown = true;
    await screen.press("Sign out");
    server.state.signOutEndpointDown = false;
    expect(screen.text()).toContain(SIGN_IN_SCREEN);
    expect(server.liveSessions.has("session-token-1")).toBe(true);
    return screen;
  };
  const storedValues = () => [...secureStore.items.values()].join("\n");

  beforeEach(() => {
    server = createSessionServer();
    secureStore = createMemorySecureStore();
    deepLinkState.url = null;
    consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
  });
  afterEach(() => {
    const logged = consoleSpies
      .flatMap((spy) => spy.mock.calls.flat<readonly (readonly unknown[])[]>())
      .map((value) => inspect(value, { depth: 8 }))
      .join("\n");
    for (const secret of ["session-token-", "signature", "member@example.test"]) {
      expect(logged).not.toContain(secret);
    }
    vi.restoreAllMocks();
  });

  it("the unfinished sign-out keeps the old session token in SecureStore, not just a flag", async () => {
    await signOutLeftUnfinished();

    expect(secureStore.items.get(PENDING_SIGN_OUT_KEY)).toBe("session-token-1");
  });

  it("revokes the old session on the server with the new session, which survives a restart", async () => {
    const screen = await signOutLeftUnfinished();

    await signIn(screen);
    await settle();

    expect(server.revokeRequests).toEqual([{ token: "session-token-1", fromSession: "session-token-2" }]);
    expect(server.liveSessions).toEqual(new Set(["session-token-2"]));
    expect(secureStore.items.has(PENDING_SIGN_OUT_KEY)).toBe(false);
    expect(storedValues()).not.toContain("session-token-1");
    expect((await launchApp()).text()).toContain(SIGNED_IN_SCREEN);
    expect(server.liveSessions.has("session-token-2")).toBe(true);
  });

  it.each([
    ["the network is down", { revokeEndpointDown: true }],
    ["the server fails", { revokeEndpointErrors: true }],
  ])("revoke fails because %s: sign-in still succeeds and the marker and old token are cleared", async (_case, failure) => {
    const screen = await signOutLeftUnfinished();
    Object.assign(server.state, failure);

    await signIn(screen);
    await settle();

    expect(screen.text()).toContain(SIGNED_IN_SCREEN);
    expect(server.revokeRequests).toHaveLength(1);
    expect(secureStore.items.has(PENDING_SIGN_OUT_KEY)).toBe(false);
    expect(storedValues()).not.toContain("session-token-1");
    expect((await launchApp()).text()).toContain(SIGNED_IN_SCREEN);
    expect(server.liveSessions.has("session-token-2")).toBe(true);
  });

  it("a sign-in with nothing pending sends no revoke", async () => {
    await signIn(await launchApp());
    await settle();

    expect(server.revokeRequests).toEqual([]);
  });
});
