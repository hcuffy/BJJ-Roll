import { AccessibilityInfo } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountExportResult } from "../auth/accountActions";
import { FAILURE_MESSAGES } from "../auth/signInActions";
import { colours } from "../theme/tokens";
import { flattenStyle, textOf } from "./screenHarness";
import { createSignedInScreenHarness, deferred, EXPORT_JSON } from "./signedInScreenHarness";

describe("SignedInScreen account actions (HEN-65)", () => {
  let harness: ReturnType<typeof createSignedInScreenHarness>;
  let state: ReturnType<typeof createSignedInScreenHarness>["state"];

  beforeEach(() => {
    harness = createSignedInScreenHarness();
    state = harness.state;
  });

  const renderSignedIn = () => harness.render();

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

    expect(state.exportCalls).toBe(1);
    expect(state.shareSpy).toHaveBeenCalledWith({ title: "BJJ Roll data export", message: EXPORT_JSON });
  });

  it("export: a double tap sends one request, and the button shows progress meanwhile", async () => {
    const pending = deferred<AccountExportResult>();
    state.exportResult = pending.promise;
    const screen = await renderSignedIn();

    const exportButton = screen.getPressable("Export my data");
    (exportButton.props.onPress as () => void)();
    (exportButton.props.onPress as () => void)();
    await screen.rerender();
    expect(screen.text()).toContain("Preparing export…");

    pending.resolve({ ok: true, json: EXPORT_JSON });
    await screen.rerender();
    expect(state.exportCalls).toBe(1);
    expect(state.shareSpy).toHaveBeenCalledTimes(1);
  });

  it("export: a failure (not the network) shows a plain message and the button retries", async () => {
    state.exportResult = Promise.resolve({ ok: false, reason: "unknown", message: FAILURE_MESSAGES.unknown });
    const screen = await renderSignedIn();

    await screen.press("Export my data");
    expect(screen.text()).toContain(`Export failed. ${FAILURE_MESSAGES.unknown}`);
    expect(state.shareSpy).not.toHaveBeenCalled();

    state.exportResult = Promise.resolve({ ok: true, json: EXPORT_JSON });
    await screen.press("Export my data");
    expect(screen.text()).not.toContain("Export failed.");
    expect(state.shareSpy).toHaveBeenCalledTimes(1);
  });

  it("delete: the first tap only asks for confirmation, says re-signup makes a new empty account; cancel sends nothing", async () => {
    const screen = await renderSignedIn();

    await screen.press("Delete account");

    expect(state.codeRequests).toBe(0);
    expect(screen.text()).toContain("Delete your account?");
    expect(screen.text()).toContain("This permanently deletes your account, handle and sign-in data now. It can't be undone.");
    expect(screen.text()).toContain("If you sign up again later, you get a new, empty account.");
    expect(screen.getPressable("Email me a code").props.accessibilityHint).toBe("Emails you a code to confirm. Nothing is deleted yet.");
    expect(screen.queryByText("Delete my account")).toBeNull();

    await screen.press("Cancel");
    expect(state.codeRequests).toBe(0);
    expect(state.deletedCodes).toEqual([]);
    expect(screen.text()).not.toContain("Delete your account?");
    expect(screen.getPressable("Delete account")).toBeDefined();
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
    expect(screen.pressables().filter((node) => flattenStyle(node.props.style).backgroundColor === colours.danger)).toEqual([]);
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

  it("design (Vera item 4): 'Export my data first' inside the confirm exports, blocks the code request meanwhile, and shows errors", async () => {
    const pending = deferred<AccountExportResult>();
    state.exportResult = pending.promise;
    const screen = await renderSignedIn();
    await screen.press("Delete account");

    const exportFirst = screen.getPressable("Export my data first");
    expect(flattenStyle(exportFirst.props.style).backgroundColor).toBeUndefined();
    expect(flattenStyle(exportFirst.props.style).minHeight).toBe(48);
    const order = screen
      .findAllByType("Text")
      .map((node) => textOf(node))
      .filter((text) => ["Export my data first", "Email me a code", "Cancel"].includes(text));
    expect(order).toEqual(["Export my data first", "Email me a code", "Cancel"]);

    await screen.press("Export my data first");
    expect(screen.text()).toContain("Preparing export…");
    expect(screen.isDisabled("Email me a code")).toBe(true);
    await screen.press("Email me a code");
    expect(state.codeRequests).toBe(0);

    pending.resolve({ ok: true, json: EXPORT_JSON });
    await screen.rerender();
    expect(state.exportCalls).toBe(1);
    expect(state.shareSpy).toHaveBeenCalledWith({ title: "BJJ Roll data export", message: EXPORT_JSON });
    expect(screen.text()).toContain("Delete your account?");
    expect(screen.isDisabled("Email me a code")).toBe(false);

    state.exportResult = Promise.resolve({ ok: false, reason: "unknown", message: FAILURE_MESSAGES.unknown });
    await screen.press("Export my data first");
    expect(screen.queryByText(`Export failed. ${FAILURE_MESSAGES.unknown}`)?.props).toMatchObject({ accessibilityRole: "alert" });
  });

  it("the confirm is a binary choice: Sign out is hidden while it is open", async () => {
    const screen = await renderSignedIn();
    await screen.press("Delete account");
    expect(screen.queryByText("Sign out")).toBeNull();

    await screen.press("Cancel");
    expect(screen.queryByText("Sign out")).not.toBeNull();
  });

  it("Bill's gap: while an export runs, the red Delete account text is disabled and shows the grey disabled label, still with no fill", async () => {
    const pending = deferred<AccountExportResult>();
    state.exportResult = pending.promise;
    const screen = await renderSignedIn();
    expect(flattenStyle(screen.queryByText("Delete account")?.props.style)).toMatchObject({ color: colours.danger });

    await screen.press("Export my data");
    expect(screen.isDisabled("Delete account")).toBe(true);
    expect(flattenStyle(screen.queryByText("Delete account")?.props.style)).toMatchObject({ color: colours.textSecondary });
    expect(flattenStyle(screen.getPressable("Delete account").props.style).backgroundColor).toBeUndefined();

    pending.resolve({ ok: true, json: EXPORT_JSON });
    await screen.rerender();
    expect(screen.isDisabled("Delete account")).toBe(false);
    expect(flattenStyle(screen.queryByText("Delete account")?.props.style)).toMatchObject({ color: colours.danger });
  });
});
