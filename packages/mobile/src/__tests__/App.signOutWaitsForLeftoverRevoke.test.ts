import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import {
  type AppClientSlot,
  createLeftoverRevokePhone,
  expectNoSecretsLogged,
  FIRST,
  SIGN_IN_SCREEN,
  SIGNED_IN_SCREEN,
  spyOnConsole,
} from "./leftoverRevokeHarness";
import { setUpPhoneWithoutBiometrics } from "./localAuthenticationFake";
import { deepLinkState, settle } from "./screenHarness";

const appClient = vi.hoisted((): AppClientSlot => ({ current: null, store: null }));
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

describe("App: sign-out waits until the aborted leftover revoke has settled (HEN-330)", () => {
  let phone: ReturnType<typeof createLeftoverRevokePhone>;
  let consoleSpies: MockInstance[];

  const holdAbortedRequests = () => {
    let release = () => undefined as void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = phone.server.fetchImplementation.getMockImplementation();
    if (!original) {
      throw new Error("no fetch implementation");
    }
    phone.server.fetchImplementation.mockImplementation(async (input, init) => {
      const outer = init?.signal;
      if (!outer) {
        return await original(input, init);
      }
      const late = new AbortController();
      outer.addEventListener("abort", () => void released.then(() => late.abort()));
      return await original(input, { ...init, signal: late.signal });
    });
    return release;
  };

  beforeEach(() => {
    setUpPhoneWithoutBiometrics();
    deepLinkState.url = null;
    consoleSpies = spyOnConsole();
    phone = createLeftoverRevokePhone(appClient, App);
  });
  afterEach(async () => {
    await settle();
    deepLinkState.url = null;
    vi.useRealTimers();
    expectNoSecretsLogged(consoleSpies);
    vi.restoreAllMocks();
  });

  it("Sign out while the launch's revoke is still settling its abort: sign-out's revoke starts only after it has settled", async () => {
    await phone.queueOldSession();
    const release = holdAbortedRequests();
    const screen = await phone.launchApp();
    expect(screen.text()).toContain(SIGNED_IN_SCREEN);
    expect(phone.server.inFlight.get(FIRST)).toBe(1);

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await screen.press("Sign out");
    await settle();
    expect(screen.text()).toContain(SIGN_IN_SCREEN);
    expect(phone.server.inFlight.get(FIRST)).toBe(1);
    expect(phone.server.peakInFlight.get(FIRST)).toBe(1);

    release();
    await settle();
    expect(phone.server.inFlight.get(FIRST)).toBe(1);
    expect(phone.server.peakInFlight.get(FIRST)).toBe(1);

    await vi.advanceTimersByTimeAsync(STARTUP_REQUEST_TIMEOUT_MS);
    await settle();
    expect(screen.text()).toContain(SIGN_IN_SCREEN);
    expect(phone.server.peakInFlight.get(FIRST)).toBe(1);
    expect(phone.server.inFlight.get(FIRST)).toBe(0);
    expect(phone.marker()).toContain(FIRST);
  });
});
