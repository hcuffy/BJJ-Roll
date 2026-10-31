import { beforeEach, describe, expect, it } from "vitest";
import { failureMessages } from "../auth/signInActions";
import { SERVER_UNREACHABLE_NOTE } from "../screens/ServerUnreachableNote";
import type { renderScreen } from "./screenHarness";
import { createSignedInScreenHarness } from "./signedInScreenHarness";

type Screen = Awaited<ReturnType<typeof renderScreen>>;
type Harness = ReturnType<typeof createSignedInScreenHarness>;

const TOGGLE = "Biometric unlock";
const TOGGLE_ERROR = "That didn't work. Try again.";
const CONFIRM = "Confirm I am 18 or older";
const DIALOG_YES = "Yes, I am 18 or older";
const EXPORT_ERROR = "Too many tries.";

const signedInActions: [string, string[]][] = [
  ["Export my data", ["Export my data"]],
  ["the 18+ tap", [CONFIRM, "Cancel"]],
  ["Delete account", ["Delete account", "Cancel"]],
  ["Sign out", ["Sign out"]],
];

describe("SignedInScreen: a signed-in action clears the biometric toggle error (HEN-311, HEN-288)", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createSignedInScreenHarness();
  });

  const leaveToggleError = async (): Promise<Screen> => {
    harness.state.biometricChangeResult = Promise.resolve({ ok: false, failure: "failed" });
    const screen = await harness.render();
    await screen.press(TOGGLE);
    expect(screen.text()).toContain(TOGGLE_ERROR);
    return screen;
  };

  it.each(signedInActions)("%s clears it", async (_action, titles) => {
    const screen = await leaveToggleError();
    for (const title of titles) {
      await screen.press(title);
    }
    expect(screen.text()).toContain(TOGGLE);
    expect(screen.text()).not.toContain(TOGGLE_ERROR);
  });

  it("Sign out still signs out when the toggle error was the only message", async () => {
    const screen = await leaveToggleError();
    await screen.press("Sign out");
    expect(harness.state.signOutCalls).toBe(1);
  });

  it("18+ offline (grey note showing), then toggle fails: only the red toggle error shows, no grey note", async () => {
    harness.state.adultResult = Promise.resolve({ ok: false, reason: "network", message: failureMessages.network });
    harness.state.biometricChangeResult = Promise.resolve({ ok: false, failure: "failed" });
    const screen = await harness.render();
    await screen.press(CONFIRM);
    await screen.press(DIALOG_YES);
    expect(screen.text()).toContain(SERVER_UNREACHABLE_NOTE);
    await screen.press(TOGGLE);
    expect(screen.text()).toContain(TOGGLE_ERROR);
    expect(screen.text()).not.toContain(SERVER_UNREACHABLE_NOTE);
  });

  it.each([
    ["fails", false],
    ["works", true],
  ])("a toggle start clears a red export error, and the toggle then %s", async (_outcome, works) => {
    harness.state.exportResult = Promise.resolve({ ok: false, reason: "rateLimited", message: EXPORT_ERROR });
    harness.state.biometricChangeResult = Promise.resolve(works ? { ok: true } : { ok: false, failure: "failed" });
    const screen = await harness.render();
    await screen.press("Export my data");
    expect(screen.text()).toContain(EXPORT_ERROR);
    await screen.press(TOGGLE);
    expect(screen.text()).not.toContain(EXPORT_ERROR);
    expect(screen.text().includes(TOGGLE_ERROR)).toBe(!works);
  });
});
