import { SIGN_UP_ATTESTATION_LABEL } from "@bjj-roll/shared";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMobileAuthClient, type MobileAuthClient } from "../auth/authClient";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL, TEST_DELETE_CODE } from "./authTestDoubles";
import { deepLinkState, renderScreen } from "./screenHarness";

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
  });

  it("a gated account deletes itself without accepting: code, DELETE /account, then the signed-out deleted notice", async () => {
    appClient.store = secureStore;
    appClient.current = createMobileAuthClient({
      backendUrl: TEST_BACKEND_URL,
      storage: secureStore,
      fetchImplementation: backend.fetchImplementation,
    });
    const screen = await renderScreen(createElement(App));
    await screen.pressRole("checkbox");
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    await screen.changeText("Email", "member@example.test");
    await screen.press("Continue with email");
    await screen.changeText("6-digit code", "123456");
    expect(screen.text()).toContain("Accept the sign-up duties");

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
});
