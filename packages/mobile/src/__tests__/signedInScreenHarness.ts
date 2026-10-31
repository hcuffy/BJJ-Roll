import { createElement } from "react";
import { AccessibilityInfo, Share } from "react-native";
import { type MockInstance, vi } from "vitest";
import type { AccountCodeResult, AccountDeletionResult, AccountExportResult, AgeConfirmationResult } from "../auth/accountActions";
import type { BiometricCheck } from "../auth/biometricUnlock";
import { SignedInScreen } from "../screens/SignedInScreen";
import { renderScreen } from "./screenHarness";

export const EXPORT_JSON = '{\n  "user": {}\n}';

export function deferred<Value>() {
  let resolve: (value: Value) => void = () => undefined;
  const promise = new Promise<Value>((resolver) => (resolve = resolver));
  return { promise, resolve };
}

export function createSignedInScreenHarness() {
  const state = {
    exportCalls: 0,
    codeRequests: 0,
    deletedCodes: [] as string[],
    deletedCalls: 0,
    signOutCalls: 0,
    exportResult: Promise.resolve<AccountExportResult>({ ok: true, json: EXPORT_JSON }),
    codeResult: Promise.resolve<AccountCodeResult>({ ok: true }),
    deleteResult: Promise.resolve<AccountDeletionResult>({ ok: true }),
    ageReads: 0,
    adultConfirmations: 0,
    ageStatusResult: Promise.resolve<AgeConfirmationResult>({
      ok: true,
      status: { age16Confirmed: true, age18Confirmed: false, canPurchase: false },
    }),
    adultResult: Promise.resolve<AgeConfirmationResult>({ ok: true, status: { age16Confirmed: true, age18Confirmed: true, canPurchase: true } }),
    shareSpy: undefined as unknown as MockInstance<typeof Share.share>,
    biometricChangeResult: Promise.resolve<BiometricCheck>({ ok: true }),
  };
  state.shareSpy = vi.spyOn(Share, "share").mockResolvedValue({ action: "sharedAction" });
  vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();

  const render = () =>
    renderScreen(
      createElement(SignedInScreen, {
        onSignOut: () => (state.signOutCalls += 1),
        onExportData: () => {
          state.exportCalls += 1;
          return state.exportResult;
        },
        onRequestDeleteCode: () => {
          state.codeRequests += 1;
          return state.codeResult;
        },
        onDeleteAccount: (code: string) => {
          state.deletedCodes.push(code);
          return state.deleteResult;
        },
        onAccountDeleted: () => (state.deletedCalls += 1),
        onReadAgeConfirmation: () => {
          state.ageReads += 1;
          return state.ageStatusResult;
        },
        onConfirmAdult: () => {
          state.adultConfirmations += 1;
          return state.adultResult;
        },
        onReadBiometricSetting: () => Promise.resolve({ available: true, on: false, kind: "biometrics" } as const),
        onChangeBiometricUnlock: () => state.biometricChangeResult,
      }),
    );

  const renderAtCodeStep = async () => {
    const screen = await render();
    await screen.press("Delete account");
    await screen.press("Email me a code");
    return screen;
  };

  return { state, render, renderAtCodeStep };
}
