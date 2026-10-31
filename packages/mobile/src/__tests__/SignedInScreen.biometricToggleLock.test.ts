import { AccessibilityInfo } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountExportResult, AgeConfirmationResult } from "../auth/accountActions";
import type { BiometricCheck } from "../auth/biometricUnlock";
import { failureMessages } from "../auth/signInActions";
import { colours } from "../theme/tokens";
import { flattenStyle, type renderScreen } from "./screenHarness";
import { createSignedInScreenHarness, deferred, EXPORT_JSON } from "./signedInScreenHarness";

type Screen = Awaited<ReturnType<typeof renderScreen>>;
type Harness = ReturnType<typeof createSignedInScreenHarness>;

const TOGGLE = "Biometric unlock";
const otherActions = ["Sign out", "Export my data", "Confirm I am 18 or older", "Delete account"];
const serverFailure = { ok: false, reason: "unknown", message: failureMessages.unknown } as const;

const labelColour = (screen: Screen) => flattenStyle(screen.queryByText(TOGGLE)?.props.style).color;
const toggleEnabled = (screen: Screen) => screen.getByLabelText(TOGGLE).props.disabled !== true;
const otherActionsDisabled = (screen: Screen) => otherActions.map((title) => screen.isDisabled(title));

describe("SignedInScreen: the biometric toggle and the other account actions lock each other (HEN-331, Vera)", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createSignedInScreenHarness();
  });

  it("the toggle label dims to the muted colour while export runs, and is back to primary after", async () => {
    const exportResult = deferred<AccountExportResult>();
    harness.state.exportResult = exportResult.promise;
    const screen = await harness.render();
    expect(labelColour(screen)).toBe(colours.textPrimary);

    await screen.press("Export my data");
    expect(labelColour(screen)).toBe(colours.textSecondary);

    exportResult.resolve({ ok: true, json: EXPORT_JSON });
    await screen.rerender();
    expect(labelColour(screen)).toBe(colours.textPrimary);
  });

  it.each([
    ["turning it on succeeds", true, { ok: true } as const],
    ["turning it on fails", true, { ok: false, failure: "failed" } as const],
    ["turning it off succeeds", false, { ok: true } as const],
  ])(
    "while the toggle saves, every other action is disabled and Sign out does nothing; all enabled again once %s",
    async (_case, startsOn, check) => {
      const change = deferred<BiometricCheck>();
      harness.state.biometricChangeResult = change.promise;
      harness.state.biometricSetting = { available: true, on: startsOn, kind: "biometrics" };
      const screen = await harness.render();
      await screen.press(TOGGLE);

      expect(otherActionsDisabled(screen)).toEqual([true, true, true, true]);
      await screen.press("Sign out");
      expect(harness.state.signOutCalls).toBe(0);

      change.resolve(check);
      await screen.rerender();
      expect(otherActionsDisabled(screen)).toEqual([false, false, false, false]);
    },
  );

  it.each([
    [
      "the share sheet is cancelled or closed",
      () => {
        harness.state.shareSpy.mockResolvedValueOnce({ action: "dismissedAction" });
      },
    ],
    [
      "the share sheet throws",
      () => {
        harness.state.shareSpy.mockRejectedValueOnce(new Error("share failed"));
      },
    ],
    [
      "the server refuses the export",
      () => {
        harness.state.exportResult = Promise.resolve(serverFailure);
      },
    ],
  ])("export: the toggle is enabled again after %s", async (_case, arrange) => {
    arrange();
    const screen = await harness.render();
    await screen.press("Export my data");
    await screen.rerender();

    expect(toggleEnabled(screen)).toBe(true);
  });

  it("18+: the toggle is enabled again after the server refuses the save", async () => {
    harness.state.adultResult = Promise.resolve<AgeConfirmationResult>(serverFailure);
    const screen = await harness.render();
    await screen.press("Confirm I am 18 or older");
    await screen.press("Yes, I am 18 or older");
    await screen.rerender();

    expect(screen.queryByText("We could not save that.")).not.toBeNull();
    expect(toggleEnabled(screen)).toBe(true);
  });

  it("disabling and re-enabling the toggle moves no focus and announces nothing", async () => {
    const exportResult = deferred<AccountExportResult>();
    harness.state.exportResult = exportResult.promise;
    const screen = await harness.render();
    vi.mocked(AccessibilityInfo.announceForAccessibility).mockClear();

    await screen.press("Export my data");
    exportResult.resolve({ ok: true, json: EXPORT_JSON });
    await screen.rerender();

    expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();
    expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
  });
});
