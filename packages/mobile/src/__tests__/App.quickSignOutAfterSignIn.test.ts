// A sign-out tapped right after a sign-in (HEN-315, Stamp's PR #76 nits): the sign-in's revoke of a queued old session is
// stopped and awaited before the sign-out starts, so the two never revoke the same session at once, and the sign-out still
// ends at the real 10 s startup timeout.
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
const { STARTUP_REQUEST_TIMEOUT_MS } = await import("../auth/startupTimeout");

const PENDING_SIGN_OUT_KEY = "bjjroll_pending_sign_out";
const SIGN_IN_SCREEN = "Sign in to BJJ Roll";
const SIGNED_IN_SCREEN = "You are signed in";
const FAKE_BACKEND_SESSION_COOKIE = "better-auth.session_token=signed-session-value";
const SESSION_PATTERN = /better-auth\.session_token=([^.;]+)\./u;
const FIRST = "session-token-1";
const SECOND = "session-token-2";

/** A server that keeps sessions; `/sign-out` ends the presented session, unless that session is set to fail or hang. */
function createSessionServer() {
  const backend = createFakeBackend();
  const liveSessions = new Set<string>();
  const state = { failFor: new Set<string>(), hangFor: new Set<string>() };
  /** Sign-out requests per session still waiting for an answer, and the most there ever were at once. */
  const inFlight = new Map<string, number>();
  const peakInFlight = new Map<string, number>();
  let signIns = 0;
  const json = (body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });

  const fetchImplementation = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const pathname = new URL(request.url).pathname;
    const session = SESSION_PATTERN.exec(request.headers.get("cookie") ?? "")?.[1] ?? null;
    if (pathname.endsWith("/sign-in/email-otp")) {
      signIns += 1;
      const token = `session-token-${String(signIns)}`;
      liveSessions.add(token);
      return json({ token, user: { id: "user-1" } }, { "set-cookie": `better-auth.session_token=${token}.signature; Path=/; HttpOnly` });
    }
    if (pathname.endsWith("/sign-out") && session !== null) {
      if (state.hangFor.has(session)) {
        // A host that never answers: the request ends only when the app aborts it.
        const waiting = (inFlight.get(session) ?? 0) + 1;
        inFlight.set(session, waiting);
        peakInFlight.set(session, Math.max(waiting, peakInFlight.get(session) ?? 0));
        return await new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () => {
            inFlight.set(session, (inFlight.get(session) ?? 1) - 1);
            reject(new DOMException("Aborted", "AbortError"));
          }),
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
  return { state, liveSessions, inFlight, peakInFlight, fetchImplementation: vi.fn(fetchImplementation) };
}

describe("Sign-out right after a sign-in (HEN-315)", () => {
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

  beforeEach(() => {
    server = createSessionServer();
    secureStore = createMemorySecureStore();
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

  it("the sign-in's revoke is stopped first, never runs beside the sign-out's, and the sign-out ends at the real 10 s timeout", async () => {
    // Session 1 signed out unconfirmed: it is queued.
    server.state.failFor.add(FIRST);
    const screen = await launchApp();
    await signIn(screen);
    await screen.press("Sign out");
    await settle();
    expect(marker()).toContain(FIRST);

    // Session 2 signs in; its revoke of session 1 hangs. The user signs out at once.
    server.state.failFor.clear();
    server.state.hangFor.add(FIRST);
    await signIn(screen);
    expect(server.inFlight.get(FIRST)).toBe(1);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await screen.press("Sign out");
    await settle();

    expect(server.peakInFlight.get(FIRST)).toBe(1);
    await vi.advanceTimersByTimeAsync(STARTUP_REQUEST_TIMEOUT_MS - 1);
    expect(screen.text()).not.toContain(SIGN_IN_SCREEN);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(screen.text()).toContain(SIGN_IN_SCREEN);
    expect(server.peakInFlight.get(FIRST)).toBe(1);
    expect(server.inFlight.get(FIRST)).toBe(0);
    expect(secureStore.items.has("bjjroll_cookie")).toBe(false);
    expect(marker()).toContain(FIRST);
    expect(marker()).toContain(SECOND);

    vi.useRealTimers();
    server.state.hangFor.clear();
    expect((await launchApp()).text()).toContain(SIGN_IN_SCREEN);
    expect([...server.liveSessions]).toEqual([]);
    expect(secureStore.items.has(PENDING_SIGN_OUT_KEY)).toBe(false);
  });
  it("a sign-in revoke still reading the queue cannot drop the sign-out's own entry for the new session", async () => {
    server.state.failFor.add(FIRST);
    const screen = await launchApp();
    await signIn(screen);
    await screen.press("Sign out");
    await settle();
    expect(marker()).toContain(FIRST);

    // The sign-in's revoke reads the queue slowly; meanwhile the user signs out and the server misses session 2's sign-out.
    let releaseRead = () => {};
    const readHeld = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const readNow = secureStore.getItemAsync;
    let holdNextQueueRead = true;
    secureStore.getItemAsync = async (key: string) => {
      if (key === PENDING_SIGN_OUT_KEY && holdNextQueueRead) {
        holdNextQueueRead = false;
        await readHeld;
      }
      return await readNow(key);
    };
    server.state.failFor = new Set([SECOND]);
    await signIn(screen);
    await screen.press("Sign out");
    await settle();
    releaseRead();
    await settle();

    expect(screen.text()).toContain(SIGN_IN_SCREEN);
    expect(secureStore.items.has("bjjroll_cookie")).toBe(false);
    expect(marker()).toContain(SECOND);

    server.state.failFor.clear();
    expect((await launchApp()).text()).toContain(SIGN_IN_SCREEN);
    expect([...server.liveSessions]).toEqual([]);
    expect(secureStore.items.has(PENDING_SIGN_OUT_KEY)).toBe(false);
  });
});
