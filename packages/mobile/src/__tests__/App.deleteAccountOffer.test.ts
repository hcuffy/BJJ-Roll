import { SIGN_UP_ATTESTATION_LABEL } from "@bjj-roll/shared";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMobileAuthClient, type MobileAuthClient } from "../auth/authClient";
import { BIOMETRIC_OFFER_BENEFIT } from "../screens/biometricCopy";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL, TEST_DELETE_CODE, seedPendingSignIn } from "./authTestDoubles";
import { resetBackListeners } from "./backHandlerHarness";
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

const SIGNED_IN_SCREEN = "You are signed in";
const SIGNED_OUT_NOTICE = "You're signed out. We couldn't confirm the delete.";
const DELETED_NOTICE = "Your account was deleted. If you sign up again, you get a new, empty account.";

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

describe("App: the biometric offer after a delete 401 or a failing session clear (HEN-329)", () => {
  let backend: ReturnType<typeof createFakeBackend>;
  let secureStore: ReturnType<typeof createMemorySecureStore>;
  let offersSeen: number;

  const launchApp = async (deleteReplies: readonly Fetch[] = []) => {
    const replies = [...deleteReplies];
    const fetchImplementation: Fetch = (input, init) => {
      const request = new Request(input, init);
      const isDelete = request.method === "DELETE" && new URL(request.url).pathname === "/account";
      const reply = isDelete ? replies.shift() : undefined;
      return reply ? reply(input, init) : backend.fetchImplementation(input, init);
    };
    appClient.store = secureStore;
    appClient.current = createMobileAuthClient({ backendUrl: TEST_BACKEND_URL, storage: secureStore, fetchImplementation });
    const screen = await renderScreen(createElement(App));
    await settle();
    return screen;
  };
  const signIn = async (screen: Awaited<ReturnType<typeof launchApp>>, email: string) => {
    await screen.pressRole("checkbox");
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    await screen.changeText("Email", email);
    await screen.press("Continue with email");
    await screen.changeText("6-digit code", "123456");
    await settle();
    if (screen.text().includes(BIOMETRIC_OFFER_BENEFIT)) {
      offersSeen += 1;
      await screen.press("Not now");
    }
    expect(screen.text()).toContain(SIGNED_IN_SCREEN);
  };
  const openCodeStep = async (screen: Awaited<ReturnType<typeof launchApp>>) => {
    await screen.press("Delete account");
    await screen.press("Email me a code");
    await screen.changeText("6-digit code", TEST_DELETE_CODE);
  };
  const pressDelete = async (screen: Awaited<ReturnType<typeof launchApp>>) => {
    await screen.press("Delete my account");
    await settle();
  };
  const lostResponse: Fetch = async (input, init) => {
    await backend.fetchImplementation(input, init);
    throw new TypeError("Network request failed");
  };
  const unauthorized: Fetch = () =>
    Promise.resolve(new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "content-type": "application/json" } }));

  beforeEach(() => {
    backend = createFakeBackend();
    secureStore = createMemorySecureStore();
    seedPendingSignIn(secureStore);
    offersSeen = 0;
    deepLinkState.url = null;
    resetBackListeners();
    setUpEnrolledPhone();
  });

  it("a confirmed delete whose session clear fails offers biometric once on the next sign-in", async () => {
    const screen = await launchApp();
    await signIn(screen, "member@example.test");
    expect(offersSeen).toBe(1);
    await openCodeStep(screen);
    secureStore.failingKeys.add("bjjroll_cookie");
    await pressDelete(screen);
    expect(screen.text()).toContain(DELETED_NOTICE);
    secureStore.failingKeys.clear();

    await signIn(screen, "newcomer@example.test");
    expect(offersSeen).toBe(2);
    await screen.press("Sign out");
    await settle();
    await signIn(screen, "newcomer@example.test");
    expect(offersSeen).toBe(2);
  });

  it.each([
    ["a retry after a lost response", [lostResponse, unauthorized], 2],
    ["the first try", [unauthorized], 1],
  ] as const)("a 401 on %s signs out without a new offer on the next sign-in", async (_label, replies, presses) => {
    const screen = await launchApp(replies);
    await signIn(screen, "member@example.test");
    expect(offersSeen).toBe(1);
    await openCodeStep(screen);
    for (let press = 0; press < presses; press += 1) {
      await pressDelete(screen);
    }
    expect(screen.text()).toContain(SIGNED_OUT_NOTICE);

    await signIn(screen, "member@example.test");
    expect(offersSeen).toBe(1);
  });
});
