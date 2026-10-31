import { beforeEach, describe, expect, it } from "vitest";
import type { AccountCodeResult } from "../auth/accountActions";
import { failureMessages } from "../auth/signInActions";
import type { renderScreen } from "./screenHarness";
import { createSignedInScreenHarness, deferred, EXPORT_JSON } from "./signedInScreenHarness";

type Screen = Awaited<ReturnType<typeof renderScreen>>;
type Harness = ReturnType<typeof createSignedInScreenHarness>;
type AccountFailure = Extract<AccountCodeResult, { ok: false }>;

const TOGGLE = "Biometric unlock";
const networkFailure: AccountFailure = { ok: false, reason: "network", message: failureMessages.network };

function toggleDisabled(screen: Screen) {
  const row = screen.getByLabelText(TOGGLE);
  const [toggleSwitch] = screen.findAllByType("Switch");
  return {
    row: row.props.disabled === true,
    screenReader: (row.props.accessibilityState as { disabled?: boolean }).disabled === true,
    switch: toggleSwitch?.props.disabled === true,
  };
}

const allDisabled = { row: true, screenReader: true, switch: true };
const allEnabled = { row: false, screenReader: false, switch: false };

describe("SignedInScreen: the biometric toggle is locked while another action runs (HEN-331)", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createSignedInScreenHarness();
  });

  const expectToggleWorksAgain = async (screen: Screen) => {
    expect(toggleDisabled(screen)).toEqual(allEnabled);
    await screen.press(TOGGLE);
    expect(harness.state.biometricChanges).toEqual([true]);
  };

  it.each([
    ["succeeds", { ok: true, json: EXPORT_JSON } as const],
    ["fails", networkFailure],
  ])("export: disabled for screen readers too while it runs, a tap changes nothing, enabled again once it %s", async (_outcome, result) => {
    const exportResult = deferred<typeof result>();
    harness.state.exportResult = exportResult.promise;
    const screen = await harness.render();
    await screen.press("Export my data");

    expect(toggleDisabled(screen)).toEqual(allDisabled);
    await screen.press(TOGGLE);
    expect(harness.state.biometricChanges).toEqual([]);

    exportResult.resolve(result);
    await screen.rerender();
    await expectToggleWorksAgain(screen);
  });

  it.each([
    ["succeeds", { ok: true } as const],
    ["fails", networkFailure],
  ])("18+ save: disabled while it runs, enabled again once it %s", async (_outcome, result) => {
    const adultResult = deferred<typeof result>();
    harness.state.adultResult = adultResult.promise.then((settled) =>
      settled.ok ? { ok: true, status: { age16Confirmed: true, age18Confirmed: true, canPurchase: true } } : settled,
    );
    const screen = await harness.render();
    await screen.press("Confirm I am 18 or older");
    await screen.press("Yes, I am 18 or older");

    expect(toggleDisabled(screen)).toEqual(allDisabled);
    await screen.press(TOGGLE);
    expect(harness.state.biometricChanges).toEqual([]);

    adultResult.resolve(result);
    await screen.rerender();
    await expectToggleWorksAgain(screen);
  });

  it("delete, code request fails: the toggle is not shown while it runs, and works again after Cancel", async () => {
    const codeResult = deferred<AccountFailure>();
    harness.state.codeResult = codeResult.promise;
    const screen = await harness.render();
    await screen.press("Delete account");
    await screen.press("Email me a code");
    expect(screen.queryByLabelText(TOGGLE)).toBeNull();

    codeResult.resolve(networkFailure);
    await screen.rerender();
    expect(screen.queryByLabelText(TOGGLE)).toBeNull();
    await screen.press("Cancel");
    await expectToggleWorksAgain(screen);
  });

  it.each([
    ["fails", networkFailure, 0],
    ["succeeds", { ok: true } as const, 1],
  ])("delete itself: the toggle is not shown while it runs and never changes; when it %s", async (_outcome, result, deletedCalls) => {
    const deleteResult = deferred<typeof result>();
    harness.state.deleteResult = deleteResult.promise;
    const screen = await harness.renderAtCodeStep();
    await screen.changeText("6-digit code", "654321");
    await screen.press("Delete my account");
    expect(screen.queryByLabelText(TOGGLE)).toBeNull();

    deleteResult.resolve(result);
    await screen.rerender();
    expect(harness.state.deletedCalls).toBe(deletedCalls);
    expect(harness.state.biometricChanges).toEqual([]);
    if (!result.ok) {
      await screen.press("Cancel");
      await expectToggleWorksAgain(screen);
    }
  });
});
