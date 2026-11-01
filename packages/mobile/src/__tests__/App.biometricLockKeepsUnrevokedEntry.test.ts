import { SIGN_UP_ATTESTATION_LABEL } from "@bjj-roll/shared";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMobileAuthClient, type MobileAuthClient } from "../auth/authClient";
import { BIOMETRIC_UNLOCK_KEY } from "../auth/biometricUnlock";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL, seedPendingSignIn } from "./authTestDoubles";
import { localAuthenticationFake, setUpEnrolledPhone, setUpPhoneWithoutBiometrics } from "./localAuthenticationFake";
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
    if (pathname.endsWith("/magic-link/exchange")) {
      signIns += 1;
      const token = `session-token-${String(signIns)}`;
      liveSessions.set(token, MEMBER_EMAIL);
      const signedValue = encodeURIComponent(`${token}.signature+${String(signIns)}=`);
      return json(
        { token, user: { id: `user-${MEMBER_EMAIL}` } },
        { "set-cookie": `better-auth.session_token=${signedValue}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800` },
      );
    }
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

const LOCKED_TITLE = "BJJ Roll is locked";

describe("a lock-path revoke that fails keeps the old session queued (HEN-288 x HEN-314, Bill gate @ f353356)", () => {
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
  const marker = () => secureStore.items.get(PENDING_SIGN_OUT_KEY) ?? null;

  beforeEach(() => {
    server = createSessionServer();
    secureStore = createMemorySecureStore();
    seedPendingSignIn(secureStore);
    deepLinkState.url = null;
    setUpPhoneWithoutBiometrics();
  });
  afterEach(() => {
    deepLinkState.url = null;
  });

  it("magic link lands on the lock while sign-out still errors: the old entry stays queued and the next launch ends it", async () => {
    const screen = await launchApp();
    await screen.pressRole("checkbox");
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    await screen.changeText("Email", MEMBER_EMAIL);
    await screen.press("Continue with email");
    await screen.changeText("6-digit code", "123456");
    server.state.signOutEndpointDown = true;
    await screen.press("Sign out");
    expect(marker()).toContain(OLD_SESSION);

    server.state.signOutEndpointDown = false;
    server.state.signOutEndpointErrors = true;
    setUpEnrolledPhone();
    await screen.pressRole("checkbox");
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    await screen.changeText("Email", MEMBER_EMAIL);
    await screen.press("Continue with email");
    await screen.changeText("6-digit code", "123456");
    await screen.press("Turn on");
    await settle();
    expect(await secureStore.getItemAsync(BIOMETRIC_UNLOCK_KEY)).toBe("on");

    const signOutsBefore = server.signOutRequests.length;
    localAuthenticationFake.answers.push("user_cancel");
    seedPendingSignIn(secureStore);
    deepLinkState.url = "bjjroll://auth?code=one-time-exchange-code";
    const linked = await launchApp();
    expect(linked.text()).toContain(LOCKED_TITLE);
    expect(server.signOutRequests.length).toBeGreaterThan(signOutsBefore);
    expect(server.liveSessions.has(OLD_SESSION)).toBe(true);
    expect(marker()).toContain(OLD_SESSION);

    server.state.signOutEndpointErrors = false;
    deepLinkState.url = null;
    localAuthenticationFake.answers.push("user_cancel");
    const relaunch = await launchApp();
    expect(relaunch.text()).toContain(LOCKED_TITLE);
    expect(server.liveSessions.has(OLD_SESSION)).toBe(false);
    expect(server.liveSessions.has("session-token-3")).toBe(true);
    expect(marker()).toBeNull();
  });
});
