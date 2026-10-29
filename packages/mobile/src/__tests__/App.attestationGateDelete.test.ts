import { SIGN_UP_ATTESTATION_LABEL } from "@bjj-roll/shared";
import { createElement } from "react";
import { Share } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMobileAuthClient, type MobileAuthClient } from "../auth/authClient";
import { createFakeBackend, createMemorySecureStore, TEST_ACCOUNT_EXPORT, TEST_BACKEND_URL, TEST_DELETE_CODE } from "./authTestDoubles";
import { pressHardwareBack, resetBackListeners } from "./backHandlerHarness";
import { deepLinkState, renderScreen } from "./screenHarness";
import { deferred } from "./signedInScreenHarness";

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

// Stamp's store check on #74 (Apple 5.1.1(v), Play account deletion): an account held at the re-accept gate can delete itself.
describe("App: delete account from the sign-up attestation gate (HEN-183)", () => {
  let backend: ReturnType<typeof createFakeBackend>;
  let secureStore: ReturnType<typeof createMemorySecureStore>;

  beforeEach(() => {
    // The account has no attestation record, so the server keeps it on the gate after sign-in.
    backend = createFakeBackend({ signUpAttestationAcceptedVersion: null });
    secureStore = createMemorySecureStore();
    deepLinkState.url = null;
    resetBackListeners();
  });

  /** Signs in with the fake backend; this account has no record, so it lands on the gate. */
  async function signInToGate(
    fetchImplementation: (input: string | URL | Request, init?: RequestInit) => Promise<Response> = backend.fetchImplementation,
  ) {
    appClient.store = secureStore;
    appClient.current = createMobileAuthClient({
      backendUrl: TEST_BACKEND_URL,
      storage: secureStore,
      fetchImplementation,
    });
    const screen = await renderScreen(createElement(App));
    await screen.pressRole("checkbox");
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    await screen.changeText("Email", "member@example.test");
    await screen.press("Continue with email");
    await screen.changeText("6-digit code", "123456");
    expect(screen.text()).toContain("Accept the sign-up duties");
    return screen;
  }

  it("a gated account deletes itself without accepting: code, DELETE /account, then the signed-out deleted notice", async () => {
    const screen = await signInToGate();

    await screen.press("Delete account");
    expect(screen.text()).toContain("Delete your account?");
    await screen.press("Email me a code");
    await screen.changeText("6-digit code", TEST_DELETE_CODE);
    await screen.press("Delete my account");

    expect(screen.text()).toContain("Your account was deleted.");
    const accountRequests = backend.requests.filter((request) => new URL(request.url).pathname.startsWith("/account"));
    expect(accountRequests.map((request) => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
      "GET /account/signup-attestation",
      "POST /account/delete-code",
      "DELETE /account",
    ]);
    expect(secureStore.items.has("bjjroll_cookie")).toBe(false);
  });

  // HEN-308 (Sara Q3): export is not attestation-gated, so the gate's confirm exports first; that records no acceptance.
  it("a gated account exports its data from the confirm without accepting, then still deletes with the emailed code", async () => {
    const shareSpy = vi.spyOn(Share, "share").mockResolvedValue({ action: "sharedAction" });
    const screen = await signInToGate();

    await screen.press("Delete account");
    await screen.press("Export my data first");
    expect(shareSpy).toHaveBeenCalledWith({ title: "BJJ Roll data export", message: JSON.stringify(TEST_ACCOUNT_EXPORT, null, 2) });
    expect(screen.text()).toContain("Delete your account?");
    await screen.press("Email me a code");
    await screen.changeText("6-digit code", TEST_DELETE_CODE);
    await screen.press("Delete my account");

    expect(screen.text()).toContain("Your account was deleted.");
    const accountRequests = backend.requests.filter((request) => new URL(request.url).pathname.startsWith("/account"));
    expect(accountRequests.map((request) => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
      "GET /account/signup-attestation",
      "GET /account/export",
      "POST /account/delete-code",
      "DELETE /account",
    ]);
  });

  // Vera #74 round 5: Android back is ignored while the DELETE is in flight, like the disabled Cancel.
  it("Android back during a pending DELETE stays on the code step, then the deletion completes", async () => {
    const release = deferred<undefined>();
    const screen = await signInToGate(async (input, init) => {
      const request = new Request(input, init);
      if (request.method === "DELETE" && new URL(request.url).pathname === "/account") {
        await release.promise;
      }
      return await backend.fetchImplementation(input, init);
    });
    await screen.press("Delete account");
    await screen.press("Email me a code");
    await screen.changeText("6-digit code", TEST_DELETE_CODE);
    await screen.press("Delete my account");
    expect(screen.text()).toContain("Deleting account…");

    expect(pressHardwareBack()).toBe(true);
    await screen.rerender();
    expect(screen.text()).toContain("Deleting account…");
    expect(screen.text()).not.toContain("Accept the sign-up duties");
    release.resolve(undefined);
    await screen.rerender();
    expect(screen.text()).toContain("Your account was deleted.");
  });
});
