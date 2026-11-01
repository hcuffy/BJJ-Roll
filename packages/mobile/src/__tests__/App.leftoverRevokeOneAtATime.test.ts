import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { BIOMETRIC_UNLOCK_KEY } from "../auth/biometricUnlock";
import { seedPendingSignIn } from "./authTestDoubles";
import { localAuthenticationFake, setUpEnrolledPhone, setUpPhoneWithoutBiometrics } from "./localAuthenticationFake";
import {
  type AppClientSlot,
  createLeftoverRevokePhone,
  expectNoSecretsLogged,
  FIRST,
  GOOD_LINK,
  LOCKED_TITLE,
  SECOND,
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

describe("App: one revoke of a queued old session at a time (HEN-330, HEN-315, HEN-310)", () => {
  let phone: ReturnType<typeof createLeftoverRevokePhone>;
  let consoleSpies: MockInstance[];

  const signOutAndRunOutTheDeadline = async (screen: Awaited<ReturnType<typeof phone.launchApp>>) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await screen.press("Sign out");
    await settle();
    await vi.advanceTimersByTimeAsync(STARTUP_REQUEST_TIMEOUT_MS);
    await settle();
    expect(screen.text()).toContain(SIGN_IN_SCREEN);
  };
  const expectOneRevokeAndEntryKept = () => {
    expect(phone.server.peakInFlight.get(FIRST)).toBe(1);
    expect(phone.server.inFlight.get(FIRST)).toBe(0);
    expect(phone.marker()).toContain(FIRST);
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

  it("Try again while the launch's revoke runs, then Sign out: one revoke at a time and the old session stays queued", async () => {
    await phone.queueOldSession();
    phone.server.state.downPaths.add("/get-session");
    const screen = await phone.launchApp();
    expect(screen.text()).toContain("Try again");
    expect(phone.server.inFlight.get(FIRST)).toBe(1);

    phone.server.state.downPaths.clear();
    await screen.press("Try again");
    await settle();
    expect(screen.text()).toContain(SIGNED_IN_SCREEN);
    expect(phone.server.peakInFlight.get(FIRST)).toBe(1);

    await signOutAndRunOutTheDeadline(screen);
    expectOneRevokeAndEntryKept();
  });

  it("sign-in while the launch's revoke runs, then Sign out: one revoke at a time and the old session stays queued", async () => {
    await phone.queueOldSession();
    phone.server.liveSessions.delete(SECOND);
    const screen = await phone.launchApp();
    expect(screen.text()).toContain(SIGN_IN_SCREEN);
    expect(phone.server.inFlight.get(FIRST)).toBe(1);

    await phone.signIn(screen);
    expect(screen.text()).toContain(SIGNED_IN_SCREEN);
    expect(phone.server.peakInFlight.get(FIRST)).toBe(1);

    await signOutAndRunOutTheDeadline(screen);
    expectOneRevokeAndEntryKept();
  });

  it("cold-start sign-in link while the launch's revoke runs, then Sign out: one revoke and the link is exchanged once", async () => {
    await phone.queueOldSession();
    seedPendingSignIn(phone.secureStore);
    deepLinkState.url = GOOD_LINK;
    const screen = await phone.launchApp();
    expect(screen.text()).toContain(SIGNED_IN_SCREEN);
    expect(phone.server.counts.exchanges).toBe(1);
    expect(phone.server.peakInFlight.get(FIRST)).toBe(1);

    await signOutAndRunOutTheDeadline(screen);
    expectOneRevokeAndEntryKept();
    expect(phone.server.counts.exchanges).toBe(1);
  });

  it("cold-start sign-in link onto the lock while the launch's revoke runs, then Sign out from the lock: one revoke, one exchange", async () => {
    await phone.queueOldSession();
    setUpEnrolledPhone();
    localAuthenticationFake.answers.push("user_cancel", "user_cancel");
    phone.secureStore.items.set(BIOMETRIC_UNLOCK_KEY, "on");
    seedPendingSignIn(phone.secureStore);
    deepLinkState.url = GOOD_LINK;
    const screen = await phone.launchApp();
    expect(screen.text()).toContain(LOCKED_TITLE);
    expect(phone.server.counts.exchanges).toBe(1);
    expect(phone.server.peakInFlight.get(FIRST)).toBe(1);

    await signOutAndRunOutTheDeadline(screen);
    expectOneRevokeAndEntryKept();
    expect(phone.server.counts.exchanges).toBe(1);
  });
});
