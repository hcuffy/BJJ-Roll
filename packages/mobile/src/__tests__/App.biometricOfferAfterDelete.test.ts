import { SIGN_UP_ATTESTATION_LABEL } from "@bjj-roll/shared";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMobileAuthClient, type MobileAuthClient } from "../auth/authClient";
import { BIOMETRIC_OFFER_BENEFIT } from "../screens/biometricCopy";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL, TEST_DELETE_CODE } from "./authTestDoubles";
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

describe("App: the biometric offer after account delete and after sign-out (HEN-300, HEN-288)", () => {
  let backend: ReturnType<typeof createFakeBackend>;
  let secureStore: ReturnType<typeof createMemorySecureStore>;
  let offersSeen: number;

  const launchApp = async () => {
    appClient.store = secureStore;
    appClient.current = createMobileAuthClient({
      backendUrl: TEST_BACKEND_URL,
      storage: secureStore,
      fetchImplementation: backend.fetchImplementation,
    });
    const screen = await renderScreen(createElement(App));
    await settle();
    return screen;
  };
  const signIn = async (screen: Awaited<ReturnType<typeof launchApp>>, email: string, landing = SIGNED_IN_SCREEN) => {
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
    expect(screen.text()).toContain(landing);
  };
  const signOut = async (screen: Awaited<ReturnType<typeof launchApp>>) => {
    await screen.press("Sign out");
    await settle();
  };
  const deleteAccount = async (screen: Awaited<ReturnType<typeof launchApp>>, code = TEST_DELETE_CODE) => {
    await screen.press("Delete account");
    await screen.press("Email me a code");
    await screen.changeText("6-digit code", code);
    await screen.press("Delete my account");
    await settle();
  };

  beforeEach(() => {
    backend = createFakeBackend();
    secureStore = createMemorySecureStore();
    offersSeen = 0;
    deepLinkState.url = null;
    resetBackListeners();
    setUpEnrolledPhone();
  });

  it("after an account delete, a new account on the same phone sees the offer once", async () => {
    const screen = await launchApp();
    await signIn(screen, "member@example.test");
    expect(offersSeen).toBe(1);
    await deleteAccount(screen);
    expect(screen.text()).toContain("Your account was deleted.");

    await signIn(screen, "newcomer@example.test");
    expect(offersSeen).toBe(2);
    await signOut(screen);
    await signIn(screen, "newcomer@example.test");
    const nextLaunch = await launchApp();
    expect(nextLaunch.text()).toContain(SIGNED_IN_SCREEN);
    expect(offersSeen).toBe(2);
  });

  it("after a sign-out, signing in again with the same or another account shows no offer", async () => {
    const screen = await launchApp();
    await signIn(screen, "member@example.test");
    expect(offersSeen).toBe(1);

    await signOut(screen);
    await signIn(screen, "member@example.test");
    await signOut(screen);
    await signIn(screen, "other@example.test");
    expect(offersSeen).toBe(1);
  });

  it("a delete refused by the server, then one that fails offline, keeps the flag: no offer after signing in again", async () => {
    const screen = await launchApp();
    await signIn(screen, "member@example.test");
    expect(offersSeen).toBe(1);
    await deleteAccount(screen, "000000");
    expect(screen.text()).not.toContain("Your account was deleted.");
    await screen.press("Cancel");
    backend.fetchImplementation.mockImplementation(async (input, init) => {
      if (new Request(input, init).method === "DELETE") {
        throw new TypeError("Network request failed");
      }
      return await createFakeBackend().fetchImplementation(input, init);
    });
    await deleteAccount(screen);
    expect(screen.text()).not.toContain("Your account was deleted.");
    backend.fetchImplementation.mockReset();
    backend = createFakeBackend();
    secureStore.items.delete("bjjroll_cookie");

    const nextLaunch = await launchApp();
    await signIn(nextLaunch, "member@example.test");
    expect(offersSeen).toBe(1);
  });

  it("a delete from the sign-up attestation gate offers biometric again on the next sign-in", async () => {
    backend = createFakeBackend({ signUpAttestationAcceptedVersion: null });
    const screen = await launchApp();
    await signIn(screen, "member@example.test", "Accept the sign-up duties");
    expect(offersSeen).toBe(1);
    await deleteAccount(screen);
    expect(screen.text()).toContain("Your account was deleted.");

    await signIn(screen, "newcomer@example.test", "Accept the sign-up duties");
    expect(offersSeen).toBe(2);
  });
});
