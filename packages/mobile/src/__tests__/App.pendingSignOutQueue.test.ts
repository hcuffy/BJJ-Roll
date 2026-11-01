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
const { STARTUP_REQUEST_TIMEOUT_MS } = await import("../auth/startupTimeout");

const PENDING_SIGN_OUT_KEY = "bjjroll_pending_sign_out";
const SIGN_IN_SCREEN = "Sign in to BJJ Roll";
const SIGNED_IN_SCREEN = "You are signed in";
const FAKE_BACKEND_SESSION_COOKIE = "better-auth.session_token=signed-session-value";
const sessionPattern = /better-auth\.session_token=([^.;]+)\./u;
const FIRST = "session-token-1";
const SECOND = "session-token-2";

function createSessionServer() {
  const backend = createFakeBackend();
  const liveSessions = new Set<string>();
  const state = { failFor: new Set<string>(), hangFor: new Set<string>() };
  let signIns = 0;
  const json = (body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });

  const fetchImplementation = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const pathname = new URL(request.url).pathname;
    const session = sessionPattern.exec(request.headers.get("cookie") ?? "")?.[1] ?? null;
    if (pathname.endsWith("/sign-in/email-otp")) {
      signIns += 1;
      const token = `session-token-${String(signIns)}`;
      liveSessions.add(token);
      return json({ token, user: { id: "user-1" } }, { "set-cookie": `better-auth.session_token=${token}.signature; Path=/; HttpOnly` });
    }
    if (pathname.endsWith("/sign-out") && session !== null) {
      if (state.hangFor.has(session)) {
        return await new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))),
        );
      }
      if (state.failFor.has(session)) {
        throw new TypeError("fetch failed");
      }
      liveSessions.delete(session);
      return json({ success: true }, { "set-cookie": "better-auth.session_token=; Path=/; Max-Age=0" });
    }
    const headers = new Headers(request.headers);
    headers.delete("cookie");
    if (session !== null && liveSessions.has(session)) {
      headers.set("cookie", FAKE_BACKEND_SESSION_COOKIE);
    }
    return await backend.fetchImplementation(new Request(request, { headers }));
  };
  return { state, liveSessions, fetchImplementation: vi.fn(fetchImplementation) };
}

describe("Pending sign-out queue: cleared per entry, only on its own confirmed end (HEN-314)", () => {
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
  const signIn = async (screen: Awaited<ReturnType<typeof launchApp>>) => {
    await screen.pressRole("checkbox");
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    await screen.changeText("Email", "member@example.test");
    await screen.press("Continue with email");
    await screen.changeText("6-digit code", "123456");
    expect(screen.text()).toContain(SIGNED_IN_SCREEN);
    await settle();
  };
  const marker = () => secureStore.items.get(PENDING_SIGN_OUT_KEY) ?? "";
  const leftoverQueuedThenSignedIn = async () => {
    server.state.failFor.add(FIRST);
    const screen = await launchApp();
    await signIn(screen);
    await screen.press("Sign out");
    await settle();
    await signIn(screen);
    expect(marker()).toContain(FIRST);
    return screen;
  };

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
    vi.useRealTimers();
    const logged = consoleSpies
      .flatMap((spy) => spy.mock.calls.flat<readonly (readonly unknown[])[]>())
      .map((value) => inspect(value, { depth: 8 }))
      .join("\n");
    for (const secret of ["session-token-", "signature", "session_token", "signed-session-value", "@example.test"]) {
      expect(logged).not.toContain(secret);
    }
    vi.restoreAllMocks();
  });

  it("2 queued: one revoke confirmed, the other fails; only the confirmed one is cleared, the failed one stays queued", async () => {
    const screen = await leftoverQueuedThenSignedIn();
    server.state.failFor.add(SECOND);
    await screen.press("Sign out");
    await settle();
    expect(marker()).toContain(FIRST);
    expect(marker()).toContain(SECOND);

    server.state.failFor.delete(SECOND);
    expect((await launchApp()).text()).toContain(SIGN_IN_SCREEN);
    expect([...server.liveSessions]).toEqual([FIRST]);
    expect(marker()).toContain(FIRST);
    expect(marker()).not.toContain(SECOND);

    server.state.failFor.clear();
    await launchApp();
    expect([...server.liveSessions]).toEqual([]);
    expect(secureStore.items.has(PENDING_SIGN_OUT_KEY)).toBe(false);
  });

  it("the 10 s timeout cuts off the leftover revoke at sign-out: it stays queued with the new one; the next launch ends both", async () => {
    const screen = await leftoverQueuedThenSignedIn();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    server.state.failFor.clear();
    server.state.hangFor.add(FIRST);

    await screen.press("Sign out");
    await settle();
    await vi.advanceTimersByTimeAsync(STARTUP_REQUEST_TIMEOUT_MS);
    await settle();
    expect(screen.text()).toContain(SIGN_IN_SCREEN);
    expect(marker()).toContain(FIRST);
    expect(marker()).toContain(SECOND);

    vi.useRealTimers();
    server.state.hangFor.clear();
    await launchApp();
    expect([...server.liveSessions]).toEqual([]);
    expect(secureStore.items.has(PENDING_SIGN_OUT_KEY)).toBe(false);
  });

  it("the 10 s timeout cuts off the launch retry: the entry stays queued and the app shows sign-in", async () => {
    const screen = await leftoverQueuedThenSignedIn();
    await screen.press("Sign out");
    await settle();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    server.state.failFor.clear();
    server.state.hangFor.add(FIRST);

    const relaunched = await launchApp();
    await vi.advanceTimersByTimeAsync(STARTUP_REQUEST_TIMEOUT_MS);
    await settle();
    expect(relaunched.text()).toContain(SIGN_IN_SCREEN);
    expect(marker()).toContain(FIRST);
    expect(server.liveSessions.has(FIRST)).toBe(true);
  });
});
