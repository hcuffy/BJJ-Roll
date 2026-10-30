// #76 (HEN-288) x #94 (HEN-310), Bill gate test: a cold-start sign-in link that shows the biometric offer drops the startup
// budget, so choosing after 10 s still reads the gate's status (Bob's merge fix, offer half; plant B5 survived without it).
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMobileAuthClient, type MobileAuthClient } from "../auth/authClient";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL } from "./authTestDoubles";
import { setUpEnrolledPhone } from "./localAuthenticationFake";
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
const { SERVER_UNREACHABLE_NOTE } = await import("../screens/EmailEntryScreen");

const SIGNED_IN_SCREEN = "You are signed in";
const SIGN_IN_LINK = "bjjroll://auth?code=one-time-exchange-code";
const FAKE_BACKEND_SESSION_COOKIE = "better-auth.session_token=signed-session-value";
const SESSION_PATTERN = /better-auth\.session_token=([^.;]+)\./u;

/** A server that keeps sessions; `/sign-out` ends the presented session unless it is set to fail or hang; some paths can be down. */
function createSessionServer() {
  const backend = createFakeBackend();
  const liveSessions = new Set<string>();
  const state = { failFor: new Set<string>(), hangFor: new Set<string>(), downPaths: new Set<string>() };
  /** Sign-out requests per session still waiting for an answer, and the most there ever were at once. */
  const inFlight = new Map<string, number>();
  const peakInFlight = new Map<string, number>();
  let signIns = 0;
  const json = (body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });
  const newSession = () => {
    signIns += 1;
    const token = `session-token-${String(signIns)}`;
    liveSessions.add(token);
    return json({ token, user: { id: "user-1" } }, { "set-cookie": `better-auth.session_token=${token}.signature; Path=/; HttpOnly` });
  };

  const fetchImplementation = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const pathname = new URL(request.url).pathname;
    if ([...state.downPaths].some((path) => pathname.endsWith(path))) {
      throw new TypeError("fetch failed");
    }
    const session = SESSION_PATTERN.exec(request.headers.get("cookie") ?? "")?.[1] ?? null;
    if (pathname.endsWith("/sign-in/email-otp") || pathname.endsWith("/magic-link/exchange")) {
      return newSession();
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
  return { state, inFlight, peakInFlight, fetchImplementation: vi.fn(fetchImplementation) };
}

describe("biometric lock with the startup Try again, abort-and-wait and the startup budget (HEN-288 x HEN-310 x HEN-315)", () => {
  let server: ReturnType<typeof createSessionServer>;
  let secureStore: ReturnType<typeof createMemorySecureStore>;

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

  beforeEach(() => {
    server = createSessionServer();
    secureStore = createMemorySecureStore();
    deepLinkState.url = null;
    setUpEnrolledPhone();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(async () => {
    await settle();
    deepLinkState.url = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("a cold-start sign-in link shows the biometric offer: choosing Not now after 10 s still reads the gate's status, no offline note", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    deepLinkState.url = SIGN_IN_LINK;
    const screen = await launchApp();
    await settle();
    expect(screen.text()).toContain("Not now");

    await vi.advanceTimersByTimeAsync(STARTUP_REQUEST_TIMEOUT_MS + 1000);
    await settle();
    await screen.press("Not now");
    await settle();

    expect(screen.text()).toContain(SIGNED_IN_SCREEN);
    expect(screen.text()).not.toContain(SERVER_UNREACHABLE_NOTE);
  });
});
