import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { BIOMETRIC_UNLOCK_KEY } from "../auth/biometricUnlock";
import { localAuthenticationFake, setUpEnrolledPhone, setUpPhoneWithoutBiometrics } from "./localAuthenticationFake";
import {
  type AppClientSlot,
  createLeftoverRevokePhone,
  expectNoSecretsLogged,
  FIRST,
  LOCKED_TITLE,
  SIGN_IN_SCREEN,
  SIGNED_IN_SCREEN,
  spyOnConsole,
} from "./leftoverRevokeHarness";
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
const { SERVER_UNREACHABLE_NOTE } = await import("../screens/EmailEntryScreen");

const unreadableStores = [
  {
    name: "the read rejects",
    break: (read: (key: string) => Promise<string | null>) => async (key: string) => {
      if (key === BIOMETRIC_UNLOCK_KEY) {
        throw new Error("keychain unavailable");
      }
      return await read(key);
    },
  },
  {
    name: "the read throws",
    break: (read: (key: string) => Promise<string | null>) => (key: string) => {
      if (key === BIOMETRIC_UNLOCK_KEY) {
        throw new Error("keychain unavailable");
      }
      return read(key);
    },
  },
];

describe("App: Try again with an unreadable biometric store while the launch's revoke runs (HEN-330, HEN-288, HEN-310)", () => {
  let phone: ReturnType<typeof createLeftoverRevokePhone>;
  let consoleSpies: MockInstance[];

  beforeEach(() => {
    setUpPhoneWithoutBiometrics();
    deepLinkState.url = null;
    consoleSpies = spyOnConsole();
    phone = createLeftoverRevokePhone(appClient, App);
  });
  afterEach(async () => {
    await settle();
    vi.useRealTimers();
    expectNoSecretsLogged(consoleSpies);
    vi.restoreAllMocks();
  });

  it.each(unreadableStores)("$name: Try again lands on the lock, never signed in, with one revoke at a time", async ({ break: breakRead }) => {
    await phone.queueOldSession();
    setUpEnrolledPhone();
    localAuthenticationFake.answers.push("user_cancel", "user_cancel");
    phone.secureStore.items.set(BIOMETRIC_UNLOCK_KEY, "on");
    phone.server.state.downPaths.add("/get-session");
    const screen = await phone.launchApp();
    expect(screen.text()).toContain(SERVER_UNREACHABLE_NOTE);
    expect(phone.server.inFlight.get(FIRST)).toBe(1);

    phone.secureStore.getItemAsync = breakRead(phone.secureStore.getItemAsync.bind(phone.secureStore));
    phone.server.state.downPaths.clear();
    await screen.press("Try again");
    await settle();
    expect(screen.text()).toContain(LOCKED_TITLE);
    expect(screen.text()).not.toContain(SIGNED_IN_SCREEN);
    expect(phone.server.peakInFlight.get(FIRST)).toBe(1);

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await screen.press("Sign out");
    await settle();
    await vi.advanceTimersByTimeAsync(STARTUP_REQUEST_TIMEOUT_MS);
    await settle();
    expect(screen.text()).toContain(SIGN_IN_SCREEN);
    expect(phone.server.peakInFlight.get(FIRST)).toBe(1);
    expect(phone.marker()).toContain(FIRST);
  });
});
