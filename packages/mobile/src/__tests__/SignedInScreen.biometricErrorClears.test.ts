// HEN-311 after #76: the biometric toggle's red error is a signed-in message too, so clearMessages() clears it with the rest.
import { beforeEach, describe, expect, it } from "vitest";
import type { renderScreen } from "./screenHarness";
import { createSignedInScreenHarness } from "./signedInScreenHarness";

type Screen = Awaited<ReturnType<typeof renderScreen>>;
type Harness = ReturnType<typeof createSignedInScreenHarness>;

const TOGGLE = "Biometric unlock";
const TOGGLE_ERROR = "That didn't work. Try again.";
const CONFIRM = "Confirm I am 18 or older";

// The 18+ dialog and the delete confirm cover the account section, so those actions close it again before the check.
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
});
