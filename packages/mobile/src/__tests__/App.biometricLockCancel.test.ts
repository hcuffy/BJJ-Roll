import { SIGN_UP_ATTESTATION_LABEL } from "@bjj-roll/shared";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMobileAuthClient, type MobileAuthClient } from "../auth/authClient";
import { BIOMETRIC_UNLOCK_KEY } from "../auth/biometricUnlock";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL } from "./authTestDoubles";
import { localAuthenticationFake, setUpEnrolledPhone } from "./localAuthenticationFake";
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
const { PENDING_SIGN_OUT_KEY } = await import("../auth/signInActions");
const { STARTUP_REQUEST_TIMEOUT_MS } = await import("../auth/startupTimeout");

const SIGN_IN_SCREEN = "Sign in to BJJ Roll";
const SIGNED_IN_SCREEN = "You are signed in";
const LOCKED_TITLE = "BJJ Roll is locked";
const SIGN_IN_LINK = "bjjroll://auth?code=one-time-exchange-code";
const FAKE_BACKEND_SESSION_COOKIE = "better-auth.session_token=signed-session-value";
const sessionPattern = /better-auth\.session_token=([^.;]+)\./u;
const FIRST = "session-token-1";

function createSessionServer() {
  const backend = createFakeBackend();
  const liveSessions = new Set<string>();
  const state = { failFor: new Set<string>(), hangFor: new Set<string>(), downPaths: new Set<string>() };
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
    const session = sessionPattern.exec(request.headers.get("cookie") ?? "")?.[1] ?? null;
    if (pathname.endsWith("/sign-in/email-otp") || pathname.endsWith("/magic-link/exchange")) {
      return newSession();
    }
    if (pathname.endsWith("/sign-out") && session !== null) {
      if (state.hangFor.has(session)) {
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

describe("lock-path cancel of a pending sign-out (HEN-324)", () => {
  let server: ReturnType<typeof createSessionServer>;
  let secureStore: ReturnType<typeof createMemorySecureStore>;
  let unhandled: unknown[];
  let consoleCalls: unknown[][];
  const recordUnhandled = (reason: unknown) => unhandled.push(reason);

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
    await settle();
  };
  const marker = () => secureStore.items.get(PENDING_SIGN_OUT_KEY) ?? "";
  const expectNoSecretsLogged = (storedValues: readonly string[]) => {
    const logged = JSON.stringify(consoleCalls);
    expect(logged).not.toContain("session-token");
    expect(logged).not.toContain(".signature");
    for (const value of storedValues.filter((stored) => stored.length > 8)) {
      expect(logged).not.toContain(value);
    }
  };
  const signedInWithOldSessionQueued = async () => {
    server.state.failFor.add(FIRST);
    const screen = await launchApp();
    await signIn(screen);
    await screen.press("Turn on");
    await settle();
    await screen.press("Sign out");
    await settle();
    await signIn(screen);
    expect(screen.text()).toContain(SIGNED_IN_SCREEN);
    await secureStore.setItemAsync(BIOMETRIC_UNLOCK_KEY, "on");
    expect(marker()).toContain(FIRST);
    server.state.failFor.clear();
    return screen;
  };
  const openLinkToLock = async (screen: Awaited<ReturnType<typeof launchApp>>) => {
    localAuthenticationFake.answers.push("user_cancel");
    deepLinkState.url = SIGN_IN_LINK;
    await screen.rerender();
    await settle();
    expect(screen.text()).toContain(LOCKED_TITLE);
  };

  beforeEach(() => {
    server = createSessionServer();
    secureStore = createMemorySecureStore();
    deepLinkState.url = null;
    unhandled = [];
    process.on("unhandledRejection", recordUnhandled);
    setUpEnrolledPhone();
    consoleCalls = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...callArguments: unknown[]) => consoleCalls.push(callArguments));
    }
  });
  afterEach(async () => {
    await settle();
    process.off("unhandledRejection", recordUnhandled);
    deepLinkState.url = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("unlock after the cancel started leaves it running once, keeps the new session, and the next sign-out stops and waits for it", async () => {
    const screen = await signedInWithOldSessionQueued();
    server.state.hangFor.add(FIRST);
    await openLinkToLock(screen);
    expect(server.inFlight.get(FIRST)).toBe(1);

    await screen.press("Unlock");
    await settle();

    expect(screen.text()).toContain(SIGNED_IN_SCREEN);
    expect(server.inFlight.get(FIRST)).toBe(1);
    expect(secureStore.items.get("bjjroll_cookie") ?? "").toContain("session-token-3");
    const storedValues = [...secureStore.items.values()];
    expect(marker()).toContain(FIRST);

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await screen.press("Sign out");
    await settle();
    expect(server.peakInFlight.get(FIRST)).toBe(1);

    await vi.advanceTimersByTimeAsync(STARTUP_REQUEST_TIMEOUT_MS);
    await settle();
    expect(screen.text()).toContain(SIGN_IN_SCREEN);
    expect(marker()).toContain(FIRST);
    expectNoSecretsLogged([...storedValues, ...secureStore.items.values()]);
  });

  it("a cancel whose queue write fails rejects nothing: the lock stays up, Unlock signs in, and the old session stays queued", async () => {
    const screen = await signedInWithOldSessionQueued();
    secureStore.failingKeys.add(PENDING_SIGN_OUT_KEY);
    await openLinkToLock(screen);
    await settle();

    expect(screen.text()).toContain(LOCKED_TITLE);
    expect(screen.text()).not.toContain(SIGNED_IN_SCREEN);
    expect(marker()).toContain(FIRST);

    await screen.press("Unlock");
    await settle();

    expect(screen.text()).toContain(SIGNED_IN_SCREEN);
    expect(unhandled).toEqual([]);
    expectNoSecretsLogged([...secureStore.items.values()]);
  });
});
