import { SIGN_UP_ATTESTATION_LABEL } from "@bjj-roll/shared";
import { inspect } from "node:util";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMobileAuthClient, type MobileAuthClient } from "../auth/authClient";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL, seedPendingSignIn } from "./authTestDoubles";
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
const sessionCookiePattern = /better-auth\.session_token=([^;]+)/u;
const MEMBER_EMAIL = "member@example.test";
const OLD_SESSION = "session-token-1";

function createSessionServer() {
  const backend = createFakeBackend();
  const liveSessions = new Map<string, string>();
  const signOutRequests: { readonly session: string | null; readonly cookie: string | null }[] = [];
  const state = { signOutEndpointDown: false, signOutEndpointErrors: false };
  let signIns = 0;

  const sessionOf = (request: Request): string | null => {
    const signedValue = sessionCookiePattern.exec(request.headers.get("cookie") ?? "")?.[1];
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
      const { email } = (await request.json()) as { email: string };
      signIns += 1;
      const token = `session-token-${String(signIns)}`;
      liveSessions.set(token, email);
      const signedValue = encodeURIComponent(`${token}.signature+${String(signIns)}=`);
      const cookie = `better-auth.session_token=${signedValue}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`;
      return json({ token, user: { id: `user-${email}` } }, { "set-cookie": cookie });
    }
    if (pathname.endsWith("/sign-out")) {
      signOutRequests.push({ session, cookie: request.headers.get("cookie") });
      if (state.signOutEndpointDown) {
        throw new TypeError("fetch failed");
      }
      if (state.signOutEndpointErrors) {
        return json({ message: "Internal Server Error" }, {}, 500);
      }
      if (session) {
        liveSessions.delete(session);
      }
      return json({ success: true }, { "set-cookie": "better-auth.session_token=; Path=/; Max-Age=0" });
    }
    const headers = new Headers(request.headers);
    headers.delete("cookie");
    if (live) {
      headers.set("cookie", FAKE_BACKEND_SESSION_COOKIE);
    }
    return await backend.fetchImplementation(new Request(request, { headers }));
  };
  return { state, liveSessions, signOutRequests, fetchImplementation: vi.fn(fetchImplementation) };
}

describe("Signing out also ends an older session still waiting to be ended (HEN-299)", () => {
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
    const screen = await renderScreen(createElement(App));
    await settle();
    return screen;
  };
  const signIn = async (screen: Awaited<ReturnType<typeof launchApp>>, email = MEMBER_EMAIL) => {
    await screen.pressRole("checkbox");
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    await screen.changeText("Email", email);
    await screen.press("Continue with email");
    await screen.changeText("6-digit code", "123456");
    expect(screen.text()).toContain(SIGNED_IN_SCREEN);
    await settle();
  };
  const signOutLeftUnfinished = async (email = MEMBER_EMAIL) => {
    const screen = await launchApp();
    await signIn(screen, email);
    server.state.signOutEndpointDown = true;
    await screen.press("Sign out");
    server.state.signOutEndpointDown = false;
    expect(screen.text()).toContain(SIGN_IN_SCREEN);
    expect(server.liveSessions.has(OLD_SESSION)).toBe(true);
    expect(secureStore.items.get("bjjroll_cookie") ?? "").not.toContain(OLD_SESSION);
    return screen;
  };
  const marker = () => secureStore.items.get(PENDING_SIGN_OUT_KEY) ?? null;

  beforeEach(() => {
    server = createSessionServer();
    secureStore = createMemorySecureStore();
    seedPendingSignIn(secureStore);
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
    for (const secret of ["session-token-", "signature", "session_token", "@example.test"]) {
      expect(logged).not.toContain(secret);
    }
    vi.restoreAllMocks();
  });

  it("signing out while the server is down keeps both sessions queued; the next launch ends both", async () => {
    const screen = await signOutLeftUnfinished();
    server.state.signOutEndpointDown = true;
    await signIn(screen);
    expect(marker()).toContain(OLD_SESSION);
    await screen.press("Sign out");
    await settle();
    expect(screen.text()).toContain(SIGN_IN_SCREEN);
    server.state.signOutEndpointDown = false;
    await launchApp();
    await settle();
    expect([...server.liveSessions.keys()]).toEqual([]);
  });
});
