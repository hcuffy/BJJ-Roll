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
const signOutWrites = [PENDING_SIGN_OUT_KEY, "bjjroll_cookie", "bjjroll_session_data"] as const;
const SIGN_IN_SCREEN = "Sign in to BJJ Roll";
const SIGNED_IN_SCREEN = "You are signed in";
const FAKE_BACKEND_SESSION_COOKIE = "better-auth.session_token=signed-session-value";
const sessionPattern = /better-auth\.session_token=([^.;]+)\./u;
const SESSION = "session-token-1";

function createSessionServer() {
  const backend = createFakeBackend();
  const liveSessions = new Set<string>();
  const state = { signOutDown: false, signOutHangs: false };
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
    if (pathname.endsWith("/sign-out")) {
      if (state.signOutHangs) {
        return await new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))),
        );
      }
      if (state.signOutDown) {
        throw new TypeError("fetch failed");
      }
      if (session) {
        liveSessions.delete(session);
      }
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

describe("Sign-out when SecureStore writes fail (HEN-314)", () => {
  let server: ReturnType<typeof createSessionServer>;
  let secureStore: ReturnType<typeof createMemorySecureStore>;
  let renderedScreens: string[] = [];
  const unhandledRejections: unknown[] = [];
  const recordUnhandled = (reason: unknown) => unhandledRejections.push(reason);
  let consoleSpies: { readonly mock: { readonly calls: readonly (readonly unknown[])[] } }[] = [];

  const launchApp = async () => {
    appClient.store = secureStore;
    appClient.current = createMobileAuthClient({
      backendUrl: TEST_BACKEND_URL,
      storage: secureStore,
      fetchImplementation: server.fetchImplementation,
    });
    renderedScreens = [];
    const screen = await renderScreen(createElement(App), (text) => renderedScreens.push(text));
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
  const signOutWithBrokenKeys = async (keys: readonly string[]) => {
    const screen = await launchApp();
    await signIn(screen);
    keys.forEach((key) => secureStore.failingKeys.add(key));
    const shownBefore = renderedScreens.length;
    await screen.press("Sign out");
    await settle();
    expect(screen.text()).toContain(SIGN_IN_SCREEN);
    return renderedScreens.slice(shownBefore);
  };

  beforeEach(() => {
    server = createSessionServer();
    secureStore = createMemorySecureStore();
    deepLinkState.url = null;
    unhandledRejections.length = 0;
    process.on("unhandledRejection", recordUnhandled);
    consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
  });
  afterEach(async () => {
    vi.useRealTimers();
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.off("unhandledRejection", recordUnhandled);
    expect(unhandledRejections).toEqual([]);
    const logged = consoleSpies
      .flatMap((spy) => spy.mock.calls.flat<readonly (readonly unknown[])[]>())
      .map((value) => inspect(value, { depth: 8 }))
      .join("\n");
    for (const secret of ["session-token-", "signature", "session_token", "signed-session-value", "@example.test"]) {
      expect(logged).not.toContain(secret);
    }
    vi.restoreAllMocks();
  });

  it("all 3 writes fail: signed out at once, the server session is ended, and the next launch stays signed out", async () => {
    const shown = await signOutWithBrokenKeys(signOutWrites);

    expect(shown.filter((text) => text.includes(SIGNED_IN_SCREEN))).toEqual([]);
    expect(secureStore.items.get("bjjroll_cookie")).toContain(SESSION);
    expect(server.liveSessions.has(SESSION)).toBe(false);
    expect((await launchApp()).text()).toContain(SIGN_IN_SCREEN);
  });

  it("all 3 writes fail and the server cannot be reached: the app still shows signed out", async () => {
    server.state.signOutDown = true;
    const shown = await signOutWithBrokenKeys(signOutWrites);

    expect(shown.filter((text) => text.includes(SIGNED_IN_SCREEN))).toEqual([]);
  });

  it.each(signOutWrites)("1 of 3 writes fails (%s): the server session is ended and the next launch stays signed out", async (key) => {
    const shown = await signOutWithBrokenKeys([key]);

    expect(shown.filter((text) => text.includes(SIGNED_IN_SCREEN))).toEqual([]);
    expect(server.liveSessions.has(SESSION)).toBe(false);
    expect((await launchApp()).text()).toContain(SIGN_IN_SCREEN);
  });

  it("a session key that cannot be deleted keeps the marker; once SecureStore works, a launch finishes and clears it", async () => {
    await signOutWithBrokenKeys(["bjjroll_cookie"]);
    expect(secureStore.items.get(PENDING_SIGN_OUT_KEY)).toContain(SESSION);

    secureStore.failingKeys.clear();
    expect((await launchApp()).text()).toContain(SIGN_IN_SCREEN);
    expect(secureStore.items.has(PENDING_SIGN_OUT_KEY)).toBe(false);
    expect(secureStore.items.get("bjjroll_cookie") ?? "").not.toContain(SESSION);
  });

  it("the server never answers: Loading, never the signed-in screen, then signed out at the deadline with the phone cleared", async () => {
    const screen = await launchApp();
    await signIn(screen);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    server.state.signOutHangs = true;
    const shownBefore = renderedScreens.length;

    await screen.press("Sign out");
    await settle();
    expect(screen.text()).toContain("Loading");
    await vi.advanceTimersByTimeAsync(STARTUP_REQUEST_TIMEOUT_MS);
    await settle();

    expect(screen.text()).toContain(SIGN_IN_SCREEN);
    expect(renderedScreens.slice(shownBefore).filter((text) => text.includes(SIGNED_IN_SCREEN))).toEqual([]);
    expect(secureStore.items.get("bjjroll_cookie") ?? "").not.toContain(SESSION);
    expect(secureStore.items.get(PENDING_SIGN_OUT_KEY)).toContain(SESSION);
  });
});
