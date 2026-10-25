import { createElement } from "react";
import { Share } from "react-native";
import { beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import type { AccountDeletionResult, AccountExportResult } from "../auth/accountActions";
import { FAILURE_MESSAGES } from "../auth/signInActions";
import { SignedInScreen } from "../screens/SignedInScreen";
import { colours } from "../theme/tokens";
import { flattenStyle, renderScreen } from "./screenHarness";

const EXPORT_JSON = '{\n  "user": {}\n}';

function deferred<Value>() {
  let resolve: (value: Value) => void = () => undefined;
  const promise = new Promise<Value>((resolver) => (resolve = resolver));
  return { promise, resolve };
}

describe("SignedInScreen account actions (HEN-65)", () => {
  let exportCalls: number;
  let deleteCalls: number;
  let deletedCalls: number;
  let signOutCalls: number;
  let exportResult: Promise<AccountExportResult>;
  let deleteResult: Promise<AccountDeletionResult>;
  let shareSpy: MockInstance<typeof Share.share>;

  beforeEach(() => {
    exportCalls = 0;
    deleteCalls = 0;
    deletedCalls = 0;
    signOutCalls = 0;
    exportResult = Promise.resolve({ ok: true, json: EXPORT_JSON });
    deleteResult = Promise.resolve({ ok: true });
    shareSpy = vi.spyOn(Share, "share").mockResolvedValue({ action: "sharedAction" });
  });

  const renderSignedIn = () =>
    renderScreen(
      createElement(SignedInScreen, {
        onSignOut: () => (signOutCalls += 1),
        onExportData: () => {
          exportCalls += 1;
          return exportResult;
        },
        onDeleteAccount: () => {
          deleteCalls += 1;
          return deleteResult;
        },
        onAccountDeleted: () => (deletedCalls += 1),
      }),
    );

  it("offers export and delete as labelled buttons with hints, next to sign-out", async () => {
    const screen = await renderSignedIn();

    expect(screen.getPressable("Export my data").props).toMatchObject({
      accessibilityRole: "button",
      accessibilityHint: "Opens the share sheet with a copy of your account data.",
    });
    expect(screen.getPressable("Delete account").props).toMatchObject({
      accessibilityRole: "button",
      accessibilityHint: "Asks you to confirm before anything is deleted.",
    });
    expect(screen.getPressable("Sign out")).toBeDefined();
  });

  it("export: shares the JSON through the share sheet", async () => {
    const screen = await renderSignedIn();

    await screen.press("Export my data");

    expect(exportCalls).toBe(1);
    expect(shareSpy).toHaveBeenCalledWith({ title: "BJJ Roll data export", message: EXPORT_JSON });
  });

  it("export: a double tap sends one request, and the button shows progress meanwhile", async () => {
    const pending = deferred<AccountExportResult>();
    exportResult = pending.promise;
    const screen = await renderSignedIn();

    const exportButton = screen.getPressable("Export my data");
    (exportButton.props.onPress as () => void)();
    (exportButton.props.onPress as () => void)();
    await screen.rerender();
    expect(screen.text()).toContain("Preparing export…");

    pending.resolve({ ok: true, json: EXPORT_JSON });
    await screen.rerender();
    expect(exportCalls).toBe(1);
    expect(shareSpy).toHaveBeenCalledTimes(1);
  });

  it("export: a failure shows a plain message and the button retries", async () => {
    exportResult = Promise.resolve({ ok: false, reason: "network", message: FAILURE_MESSAGES.network });
    const screen = await renderSignedIn();

    await screen.press("Export my data");
    expect(screen.text()).toContain(`Export failed. ${FAILURE_MESSAGES.network}`);
    expect(shareSpy).not.toHaveBeenCalled();

    exportResult = Promise.resolve({ ok: true, json: EXPORT_JSON });
    await screen.press("Export my data");
    expect(screen.text()).not.toContain("Export failed.");
    expect(shareSpy).toHaveBeenCalledTimes(1);
  });

  it("delete: the first tap only asks for confirmation; cancel goes back without a request", async () => {
    const screen = await renderSignedIn();

    await screen.press("Delete account");

    expect(deleteCalls).toBe(0);
    expect(screen.text()).toContain("Delete your account?");
    expect(screen.text()).toContain("This permanently deletes your account, handle and sign-in data now. It can't be undone.");
    expect(screen.getPressable("Delete my account").props.accessibilityHint).toBe("Deletes your account now and signs you out.");

    await screen.press("Cancel");
    expect(deleteCalls).toBe(0);
    expect(screen.text()).not.toContain("Delete your account?");
    expect(screen.getPressable("Delete account")).toBeDefined();
  });

  it("delete: the confirm pill is a filled danger pill with a text label, not colour only", async () => {
    const screen = await renderSignedIn();
    await screen.press("Delete account");

    const confirm = screen.getPressable("Delete my account");
    expect(flattenStyle(confirm.props.style)).toMatchObject({ backgroundColor: colours.danger });
    expect(screen.queryByText("Delete my account")).not.toBeNull();
  });

  it("delete: confirming calls the backend once even on a double tap, then reports the account deleted", async () => {
    const pending = deferred<AccountDeletionResult>();
    deleteResult = pending.promise;
    const screen = await renderSignedIn();
    await screen.press("Delete account");

    const confirm = screen.getPressable("Delete my account");
    (confirm.props.onPress as () => void)();
    (confirm.props.onPress as () => void)();
    await screen.rerender();
    expect(screen.text()).toContain("Deleting account…");
    expect(screen.isDisabled("Cancel")).toBe(true);
    expect(screen.isDisabled("Sign out")).toBe(true);

    pending.resolve({ ok: true });
    await screen.rerender();
    expect(deleteCalls).toBe(1);
    expect(deletedCalls).toBe(1);
  });

  it("delete: a failure says the account was not deleted, stays on the confirm step, and retries", async () => {
    deleteResult = Promise.resolve({ ok: false, reason: "unknown", message: FAILURE_MESSAGES.unknown });
    const screen = await renderSignedIn();
    await screen.press("Delete account");

    await screen.press("Delete my account");
    expect(deletedCalls).toBe(0);
    expect(screen.text()).toContain(`Your account was not deleted. ${FAILURE_MESSAGES.unknown}`);
    expect(screen.queryByText(`Your account was not deleted. ${FAILURE_MESSAGES.unknown}`)?.props).toMatchObject({ accessibilityRole: "alert" });

    deleteResult = Promise.resolve({ ok: true });
    await screen.press("Delete my account");
    expect(deleteCalls).toBe(2);
    expect(deletedCalls).toBe(1);
  });
});
