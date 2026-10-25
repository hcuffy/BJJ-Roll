import { createElement } from "react";
import { AccessibilityInfo, Share } from "react-native";
import { beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import type { AccountDeletionResult, AccountExportResult } from "../auth/accountActions";
import { FAILURE_MESSAGES } from "../auth/signInActions";
import { SignedInScreen } from "../screens/SignedInScreen";
import { colours } from "../theme/tokens";
import { flattenStyle, renderScreen, textOf } from "./screenHarness";

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
    vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
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

  it("design (Vera item 1): Sign out comes first; an Account section at the bottom ends with Delete account as red text", async () => {
    const screen = await renderSignedIn();

    const order = screen
      .findAllByType("Text")
      .map((node) => textOf(node))
      .filter((text) => ["Sign out", "Account", "Export my data", "Delete account"].includes(text));
    expect(order).toEqual(["Sign out", "Account", "Export my data", "Delete account"]);
    expect(flattenStyle(screen.queryByText("Account")?.props.style)).toMatchObject({ fontSize: 13, lineHeight: 18, color: colours.textSecondary });

    const deleteEntry = screen.getPressable("Delete account");
    const deleteEntryStyle = flattenStyle(deleteEntry.props.style);
    expect(deleteEntryStyle.backgroundColor).toBeUndefined();
    expect(deleteEntryStyle.minHeight).toBe(48);
    expect(flattenStyle(screen.queryByText("Delete account")?.props.style)).toMatchObject({ color: colours.danger });
    // The filled red pill is kept for the confirm step only.
    expect(screen.pressables().filter((node) => flattenStyle(node.props.style).backgroundColor === colours.danger)).toEqual([]);
  });

  it("design: the confirm pill label is the dark #111313 on red, never white", async () => {
    const screen = await renderSignedIn();
    await screen.press("Delete account");

    expect(flattenStyle(screen.queryByText("Delete my account")?.props.style)).toMatchObject({ color: colours.onPrimary });
    expect(colours.onPrimary).toBe("#111313");
  });

  it("a11y (Vera item 2): opening the confirm moves screen-reader focus to its heading; Cancel moves it back to Delete account", async () => {
    const screen = await renderSignedIn();
    const focusEvents = vi.mocked(AccessibilityInfo.sendAccessibilityEvent);
    expect(focusEvents).not.toHaveBeenCalled();

    await screen.press("Delete account");
    expect(focusEvents).toHaveBeenCalledTimes(1);
    const [headingTarget, headingEvent] = focusEvents.mock.calls[0] ?? [];
    expect(headingEvent).toBe("focus");
    expect(textOf(headingTarget as never)).toBe("Delete your account?");
    expect((headingTarget as unknown as { props: { accessibilityRole: string } }).props.accessibilityRole).toBe("header");

    await screen.press("Cancel");
    expect(focusEvents).toHaveBeenCalledTimes(2);
    const [returnTarget, returnEvent] = focusEvents.mock.calls[1] ?? [];
    expect(returnEvent).toBe("focus");
    expect(returnTarget).toBe(screen.getPressable("Delete account"));
  });

  it("design (Vera item 4): 'Export my data first' inside the confirm exports, blocks the danger pill meanwhile, and shows errors", async () => {
    const pending = deferred<AccountExportResult>();
    exportResult = pending.promise;
    const screen = await renderSignedIn();
    await screen.press("Delete account");

    const exportFirst = screen.getPressable("Export my data first");
    expect(flattenStyle(exportFirst.props.style).backgroundColor).toBeUndefined();
    expect(flattenStyle(exportFirst.props.style).minHeight).toBe(48);
    const order = screen
      .findAllByType("Text")
      .map((node) => textOf(node))
      .filter((text) => ["Export my data first", "Delete my account", "Cancel"].includes(text));
    expect(order).toEqual(["Export my data first", "Delete my account", "Cancel"]);

    await screen.press("Export my data first");
    expect(screen.text()).toContain("Preparing export…");
    expect(screen.isDisabled("Delete my account")).toBe(true);
    await screen.press("Delete my account");
    expect(deleteCalls).toBe(0);

    pending.resolve({ ok: true, json: EXPORT_JSON });
    await screen.rerender();
    expect(exportCalls).toBe(1);
    expect(shareSpy).toHaveBeenCalledWith({ title: "BJJ Roll data export", message: EXPORT_JSON });
    expect(screen.text()).toContain("Delete your account?");
    expect(screen.isDisabled("Delete my account")).toBe(false);

    exportResult = Promise.resolve({ ok: false, reason: "network", message: FAILURE_MESSAGES.network });
    await screen.press("Export my data first");
    expect(screen.queryByText(`Export failed. ${FAILURE_MESSAGES.network}`)?.props).toMatchObject({ accessibilityRole: "alert" });
  });

  it("the confirm is a binary choice: Sign out is hidden while it is open", async () => {
    const screen = await renderSignedIn();
    await screen.press("Delete account");
    expect(screen.queryByText("Sign out")).toBeNull();

    await screen.press("Cancel");
    expect(screen.queryByText("Sign out")).not.toBeNull();
  });
});
