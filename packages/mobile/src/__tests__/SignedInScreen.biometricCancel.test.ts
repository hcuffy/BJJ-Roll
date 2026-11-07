import { beforeEach, describe, expect, it } from "vitest";
import type { BiometricCheck } from "../auth/biometricUnlock";
import { colours } from "../theme/tokens";
import { flattenStyle, type renderScreen } from "./screenHarness";
import { createSignedInScreenHarness, deferred } from "./signedInScreenHarness";

type Screen = Awaited<ReturnType<typeof renderScreen>>;
type Harness = ReturnType<typeof createSignedInScreenHarness>;

const TOGGLE = "Biometric unlock";
const OTHER_ACTIONS = ["Sign out", "Export my data", "Confirm I am 18 or older", "Delete account"];
const CANCELLED: BiometricCheck = { ok: false, failure: "cancelled" };

const otherActionsDisabled = (screen: Screen) => OTHER_ACTIONS.map((title) => screen.isDisabled(title));
const redMessages = (screen: Screen) =>
  screen
    .findAllByType("Text")
    .filter((text) => flattenStyle(text.props.style).color === colours.danger)
    .map((text) => text.props.children)
    .filter((children) => children !== "Delete account");

describe("SignedInScreen: cancelling the biometric turn-on prompt (HEN-354)", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createSignedInScreenHarness();
  });

  it("re-enables Sign out, Export, 18+ and Delete after the prompt is cancelled", async () => {
    const change = deferred<BiometricCheck>();
    harness.state.biometricChangeResult = change.promise;
    const screen = await harness.render();
    await screen.press(TOGGLE);
    expect(harness.state.biometricChanges).toEqual([true]);
    expect(otherActionsDisabled(screen)).toEqual([true, true, true, true]);

    change.resolve(CANCELLED);
    await screen.rerender();

    expect(otherActionsDisabled(screen)).toEqual([false, false, false, false]);
  });

  it.each([
    ["cancelled", false, CANCELLED],
    ["failed", true, { ok: false, failure: "failed" } as const],
  ])("a %s prompt: red error shown is %s", async (_case, showsError, check) => {
    harness.state.biometricChangeResult = Promise.resolve(check);
    const screen = await harness.render();
    expect(redMessages(screen)).toEqual([]);

    await screen.press(TOGGLE);
    await screen.rerender();

    expect(redMessages(screen).length > 0).toBe(showsError);
  });
});
