import { SIGN_UP_ATTESTATION_TEXT_VERSION } from "@bjj-roll/shared";
import { createElement } from "react";
import { Share, Text } from "react-native";
import { beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import type { AccountCodeResult, AccountDeletionResult, AccountExportResult, SignUpAttestationResult } from "../auth/accountActions";
import { FAILURE_MESSAGES } from "../auth/signInActions";
import { SignUpAttestationGate } from "../screens/SignUpAttestationGate";
import { colours } from "../theme/tokens";
import { pressHardwareBack, resetBackListeners } from "./backHandlerHarness";
import { flattenStyle, renderScreen } from "./screenHarness";
import { deferred, EXPORT_JSON } from "./signedInScreenHarness";

const EXPORT_FIRST = "Export my data first";
const CONFIRM_TITLE = "Delete your account?";
const EMAIL_CODE = "Email me a code";
const prompt: SignUpAttestationResult = {
  ok: true,
  status: { required: true, currentTextVersionId: SIGN_UP_ATTESTATION_TEXT_VERSION.id, acceptedTextVersionId: null },
};
const readError: SignUpAttestationResult = { ok: false, reason: "unknown", message: FAILURE_MESSAGES.unknown };
const gateScreens = [
  ["the re-accept prompt", prompt],
  ["the status-read error screen", readError],
] as const;

/** A gated account whose export takes the next queued result; counts accepts, exports and code requests. */
async function renderGate(read: SignUpAttestationResult, exportResults: Promise<AccountExportResult>[] = []) {
  const calls = { accepts: 0, exports: 0, deleteCodes: 0 };
  const screen = await renderScreen(
    createElement(
      SignUpAttestationGate,
      {
        onReadStatus: () => Promise.resolve(read),
        onAccept: () => {
          calls.accepts += 1;
          return Promise.resolve(prompt);
        },
        onSignOut: () => undefined,
        onExportData: (): Promise<AccountExportResult> =>
          exportResults[calls.exports++] ?? Promise.resolve<AccountExportResult>({ ok: true, json: EXPORT_JSON }),
        onRequestDeleteCode: () => {
          calls.deleteCodes += 1;
          return Promise.resolve<AccountCodeResult>({ ok: true });
        },
        onDeleteAccount: () => Promise.resolve<AccountDeletionResult>({ ok: true }),
        onAccountDeleted: () => undefined,
      },
      createElement(Text, null, "Account content"),
    ),
  );
  await screen.press("Delete account");
  return { calls, screen };
}

// HEN-308 (Sara Q3): GET /account/export is not attestation-gated, so the gate's confirm offers export like the signed-in flow.
describe("SignUpAttestationGate: Export my data first on the delete confirm", () => {
  let shareSpy: MockInstance<typeof Share.share>;

  beforeEach(() => {
    shareSpy = vi.spyOn(Share, "share").mockResolvedValue({ action: "sharedAction" });
    resetBackListeners();
  });

  it.each(gateScreens)("from %s: the option shows above Email me a code, with the signed-in label and hint", async (_case, read) => {
    const { screen } = await renderGate(read);

    expect(screen.text()).toContain(CONFIRM_TITLE);
    const exportFirst = screen.getPressable(EXPORT_FIRST);
    expect(exportFirst.props.accessibilityHint).toBe("Opens the share sheet with a copy of your account data. Nothing is deleted.");
    expect(flattenStyle(exportFirst.props.style).backgroundColor).toBeUndefined();
    expect(screen.text().indexOf(EXPORT_FIRST)).toBeLessThan(screen.text().indexOf(EMAIL_CODE));
  });

  it.each(gateScreens)("from %s: export shares the JSON without accepting, sends no code and stays on the confirm", async (_case, read) => {
    const { calls, screen } = await renderGate(read);
    await screen.press(EXPORT_FIRST);

    expect(calls.exports).toBe(1);
    expect(shareSpy).toHaveBeenCalledWith({ title: "BJJ Roll data export", message: EXPORT_JSON });
    expect(calls.accepts).toBe(0);
    expect(calls.deleteCodes).toBe(0);
    expect(screen.text()).toContain(CONFIRM_TITLE);
    expect(screen.text()).not.toContain("Account content");
  });

  it("while the export runs, Email me a code, Cancel and Android back do nothing; then they work again", async () => {
    const pending = deferred<AccountExportResult>();
    const { calls, screen } = await renderGate(prompt, [pending.promise]);
    await screen.press(EXPORT_FIRST);

    expect(screen.text()).toContain("Preparing export…");
    expect(screen.isDisabled(EMAIL_CODE)).toBe(true);
    expect(screen.isDisabled("Cancel")).toBe(true);
    await screen.press(EMAIL_CODE);
    expect(pressHardwareBack()).toBe(true);
    await screen.rerender();
    expect(calls.deleteCodes).toBe(0);
    expect(screen.text()).toContain(CONFIRM_TITLE);

    pending.resolve({ ok: true, json: EXPORT_JSON });
    await screen.rerender();
    expect(screen.isDisabled(EMAIL_CODE)).toBe(false);
    await screen.press(EMAIL_CODE);
    expect(calls.deleteCodes).toBe(1);
  });

  it("a failed export shows the signed-in red alert; Cancel clears it and a retry can succeed", async () => {
    const failed = Promise.resolve<AccountExportResult>({ ok: false, reason: "network", message: FAILURE_MESSAGES.network });
    const { calls, screen } = await renderGate(readError, [failed]);
    await screen.press(EXPORT_FIRST);

    const error = `Export failed. ${FAILURE_MESSAGES.network}`;
    expect(screen.queryByText(error)?.props).toMatchObject({ accessibilityRole: "alert" });
    expect(flattenStyle(screen.queryByText(error)?.props.style).color).toBe(colours.danger);
    expect(shareSpy).not.toHaveBeenCalled();

    await screen.press("Cancel");
    await screen.press("Delete account");
    expect(screen.text()).not.toContain(error);
    await screen.press(EXPORT_FIRST);
    expect(calls.exports).toBe(2);
    expect(shareSpy).toHaveBeenCalledTimes(1);
  });

  it("a share sheet that throws shows the generic export failure", async () => {
    shareSpy.mockRejectedValueOnce(new Error("share failed"));
    const { screen } = await renderGate(prompt);
    await screen.press(EXPORT_FIRST);

    expect(screen.text()).toContain(`Export failed. ${FAILURE_MESSAGES.unknown}`);
  });
});
