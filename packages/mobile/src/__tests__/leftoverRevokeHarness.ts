import { SIGN_UP_ATTESTATION_LABEL } from "@bjj-roll/shared";
import { inspect } from "node:util";
import { createElement, type ComponentType } from "react";
import { expect, vi, type MockInstance } from "vitest";
import { createMobileAuthClient, type MobileAuthClient } from "../auth/authClient";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL } from "./authTestDoubles";
import { renderScreen, settle } from "./screenHarness";

export const FIRST = "session-token-1";
export const SECOND = "session-token-2";
export const SIGN_IN_SCREEN = "Sign in to BJJ Roll";
export const SIGNED_IN_SCREEN = "You are signed in";
export const LOCKED_TITLE = "BJJ Roll is locked";
export const GOOD_LINK = "bjjroll://auth?code=one-time-exchange-code";
const PENDING_SIGN_OUT_KEY = "bjjroll_pending_sign_out";
const FAKE_BACKEND_SESSION_COOKIE = "better-auth.session_token=signed-session-value";
const SESSION_PATTERN = /better-auth\.session_token=([^.;]+)\./u;
const LOGGED_SECRETS = ["session-token-", "signature", "session_token", "signed-session-value", "@example.test"];

export interface AppClientSlot {
  current: MobileAuthClient | null;
  store: ReturnType<typeof createMemorySecureStore> | null;
}

export function createSessionServer() {
  const backend = createFakeBackend();
  const liveSessions = new Set<string>();
  const state = { failFor: new Set<string>(), hangFor: new Set<string>(), downPaths: new Set<string>() };
  const inFlight = new Map<string, number>();
  const peakInFlight = new Map<string, number>();
  const counts = { signIns: 0, exchanges: 0 };
  const json = (body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });
  const newSession = () => {
    counts.signIns += 1;
    const token = `session-token-${String(counts.signIns)}`;
    liveSessions.add(token);
    return json({ token, user: { id: "user-1" } }, { "set-cookie": `better-auth.session_token=${token}.signature; Path=/; HttpOnly` });
  };
  const hang = (session: string, signal?: AbortSignal | null) => {
    const waiting = (inFlight.get(session) ?? 0) + 1;
    inFlight.set(session, waiting);
    peakInFlight.set(session, Math.max(waiting, peakInFlight.get(session) ?? 0));
    return new Promise<Response>((_resolve, reject) =>
      signal?.addEventListener("abort", () => {
        inFlight.set(session, (inFlight.get(session) ?? 1) - 1);
        reject(new DOMException("Aborted", "AbortError"));
      }),
    );
  };

  const fetchImplementation = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const pathname = new URL(request.url).pathname;
    if ([...state.downPaths].some((path) => pathname.endsWith(path))) {
      throw new TypeError("fetch failed");
    }
    const session = SESSION_PATTERN.exec(request.headers.get("cookie") ?? "")?.[1] ?? null;
    if (pathname.endsWith("/magic-link/exchange")) {
      counts.exchanges += 1;
      return newSession();
    }
    if (pathname.endsWith("/sign-in/email-otp")) {
      return newSession();
    }
    if (pathname.endsWith("/sign-out") && session !== null) {
      if (state.hangFor.has(session)) {
        return await hang(session, init?.signal);
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
  return { state, liveSessions, inFlight, peakInFlight, counts, fetchImplementation: vi.fn(fetchImplementation) };
}

export function createLeftoverRevokePhone(appClient: AppClientSlot, app: ComponentType) {
  const server = createSessionServer();
  const secureStore = createMemorySecureStore();
  const launchApp = async () => {
    appClient.store = secureStore;
    appClient.current = createMobileAuthClient({
      backendUrl: TEST_BACKEND_URL,
      storage: secureStore,
      fetchImplementation: server.fetchImplementation,
    });
    const screen = await renderScreen(createElement(app));
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
  const queueOldSession = async () => {
    server.state.failFor.add(FIRST);
    const screen = await launchApp();
    await signIn(screen);
    await screen.press("Sign out");
    await settle();
    await signIn(screen);
    expect(screen.text()).toContain(SIGNED_IN_SCREEN);
    expect(marker()).toContain(FIRST);
    server.state.failFor.clear();
    server.state.hangFor.add(FIRST);
  };
  return { server, secureStore, launchApp, signIn, marker, queueOldSession };
}

export function spyOnConsole(): MockInstance[] {
  return (["log", "info", "warn", "error", "debug"] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => undefined));
}

export function expectNoSecretsLogged(spies: readonly MockInstance[]): void {
  const logged = spies
    .flatMap((spy): unknown[] => spy.mock.calls.flat())
    .map((value) => inspect(value, { depth: 8 }))
    .join("\n");
  for (const secret of LOGGED_SECRETS) {
    expect(logged).not.toContain(secret);
  }
}
