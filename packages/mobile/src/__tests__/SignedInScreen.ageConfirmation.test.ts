import { AccessibilityInfo, Platform } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgeConfirmationResult } from "../auth/accountActions";
import { AGE_ADULT_CONFIRMATION_NOTE } from "../auth/ageConfirmation";
import { FAILURE_MESSAGES } from "../auth/signInActions";
import { colours } from "../theme/tokens";
import { flattenStyle, textOf } from "./screenHarness";
import { createSignedInScreenHarness, deferred } from "./signedInScreenHarness";

const CONFIRM = "Confirm I am 18 or older";
const CONFIRMED = "18 or older: confirmed";
const CANT_UNDO = "You can't undo this, except by deleting your account.";
const DIALOG_TITLE = "Confirm you are 18 or older?";
const DIALOG_YES = "Yes, I am 18 or older";

describe("SignedInScreen 18+ confirmation (HEN-263)", () => {
  let harness: ReturnType<typeof createSignedInScreenHarness>;

  beforeEach(() => {
    harness = createSignedInScreenHarness();
  });

  it("offers the 18+ confirm in Account, says visibly it cannot be undone, and records it once after the dialog", async () => {
    const screen = await harness.render();
    expect(harness.state.ageReads).toBe(1);
    expect(screen.getPressable(CONFIRM).props).toMatchObject({
      accessibilityRole: "button",
      accessibilityHint: "Asks you to confirm first. Needed for buying later.",
    });
    const text = screen.text();
    expect(text.indexOf(CANT_UNDO)).toBeGreaterThan(text.indexOf(CONFIRM));
    // Henry Q3: the sign-up note stays on sign-up; the Account box keeps its own copy.
    expect(text).not.toContain(AGE_ADULT_CONFIRMATION_NOTE);
    expect(flattenStyle(screen.queryByText(CANT_UNDO)?.props.style).color).toBe(colours.textSecondary);

    await screen.press(CONFIRM);
    expect(harness.state.adultConfirmations).toBe(0);
    expect(screen.text()).toContain(DIALOG_TITLE);
    expect(screen.text()).toContain(CANT_UNDO);
    expect(flattenStyle(screen.queryByText("Needed for buying later.")?.props.style).color).toBe(colours.textSecondary);

    const pending = deferred<AgeConfirmationResult>();
    harness.state.adultResult = pending.promise;
    const yes = screen.getPressable(DIALOG_YES);
    (yes.props.onPress as () => void)();
    (yes.props.onPress as () => void)();
    await screen.rerender();
    pending.resolve({ ok: true, status: { age16Confirmed: true, age18Confirmed: true, canPurchase: true } });
    await screen.rerender();

    expect(harness.state.adultConfirmations).toBe(1);
    expect(screen.text()).toContain(CONFIRMED);
    expect(screen.queryByText(CONFIRM)).toBeNull();
    expect(screen.queryByText(CANT_UNDO)).toBeNull();
  });

  it("the confirm dialog moves focus to its heading; Cancel writes nothing and returns focus to the button", async () => {
    const screen = await harness.render();
    await screen.press(CONFIRM);
    const focusEvents = vi.mocked(AccessibilityInfo.sendAccessibilityEvent);
    const [headingTarget, headingEvent] = focusEvents.mock.calls.at(-1) ?? [];
    expect(headingEvent).toBe("focus");
    expect(textOf(headingTarget as never)).toBe(DIALOG_TITLE);
    expect(screen.getPressable(DIALOG_YES)).toBeDefined();

    await screen.press("Cancel");
    expect(harness.state.adultConfirmations).toBe(0);
    expect(screen.queryByText(DIALOG_TITLE)).toBeNull();
    expect(screen.text()).not.toContain(CONFIRMED);
    const [returnTarget, returnEvent] = focusEvents.mock.calls.at(-1) ?? [];
    expect(returnEvent).toBe("focus");
    expect(returnTarget).toBe(screen.getPressable(CONFIRM));
  });

  it("shows the confirmed line instead of the button when the account already confirmed 18+", async () => {
    harness.state.ageStatusResult = Promise.resolve({ ok: true, status: { age16Confirmed: true, age18Confirmed: true, canPurchase: true } });
    const screen = await harness.render();

    expect(screen.queryByText(CONFIRM)).toBeNull();
    const row = screen.findAllByType("View").find((view) => textOf(view) === `✓${CONFIRMED}`);
    expect(flattenStyle(row?.props.style)).toMatchObject({ minHeight: 48, paddingHorizontal: 24 });
    const tick = screen.findAllByType("Text").find((node) => textOf(node) === "✓");
    expect(tick?.props).toMatchObject({ accessibilityElementsHidden: true, importantForAccessibility: "no" });
    expect(flattenStyle(tick?.props.style).color).toBe(colours.textSecondary);
    expect(flattenStyle(screen.queryByText(CONFIRMED)?.props.style).color).toBe(colours.textSecondary);
  });

  it("keeps a 48-tall 'Checking…' slot while the status loads, then swaps in the button", async () => {
    const pending = deferred<AgeConfirmationResult>();
    harness.state.ageStatusResult = pending.promise;
    const screen = await harness.render();
    const slot = screen.findAllByType("View").find((view) => textOf(view) === "Checking…");
    expect(flattenStyle(slot?.props.style).minHeight).toBe(48);
    expect(flattenStyle(screen.queryByText("Checking…")?.props.style).color).toBe(colours.textSecondary);
    expect(screen.queryByText(CONFIRM)).toBeNull();

    pending.resolve({ ok: true, status: { age16Confirmed: true, age18Confirmed: false, canPurchase: false } });
    await screen.rerender();
    expect(screen.queryByText("Checking…")).toBeNull();
    expect(screen.getPressable(CONFIRM)).toBeDefined();
  });

  it("puts 8 between the Account label and its first item, and 16 between items", async () => {
    const screen = await harness.render();
    const views = screen.findAllByType("View");
    const section = views.find((view) => flattenStyle(view.props.style).marginTop === 16 && textOf(view).startsWith("Account"));
    expect(flattenStyle(section?.props.style).gap).toBe(8);
    const items = views.find((view) => flattenStyle(view.props.style).gap === 16 && textOf(view).startsWith("Export my data"));
    expect(textOf(items ?? "")).toContain("Delete account");
  });

  it("a failed save shows a plain message and keeps the button for a retry; a failed read still shows the button", async () => {
    // A network failure gets the grey note instead (HEN-311, SignedInScreen.adultOfflineNote.test.ts).
    harness.state.adultResult = Promise.resolve({ ok: false, reason: "unknown", message: FAILURE_MESSAGES.unknown });
    const screen = await harness.render();
    await screen.press(CONFIRM);
    await screen.press(DIALOG_YES);
    expect(screen.text()).toContain(`We could not save that. ${FAILURE_MESSAGES.unknown}`);
    expect(screen.getPressable(CONFIRM)).toBeDefined();

    harness.state.ageStatusResult = Promise.resolve({ ok: false, reason: "network", message: FAILURE_MESSAGES.network });
    const unread = await harness.render();
    expect(unread.getPressable(CONFIRM)).toBeDefined();
    expect(unread.text()).toContain(CANT_UNDO);
    expect(unread.text()).not.toContain(CONFIRMED);
    expect(unread.queryByText("Checking…")).toBeNull();
  });

  it("delta 1 / round 4 item 2: after Yes, focus goes to Saving…, then to the confirmed row; the focus move alone reads it", async () => {
    Platform.OS = "ios";
    vi.mocked(AccessibilityInfo.announceForAccessibility).mockClear();
    const pending = deferred<AgeConfirmationResult>();
    harness.state.adultResult = pending.promise;
    const screen = await harness.render();
    await screen.press(CONFIRM);
    await screen.press(DIALOG_YES);
    const focusEvents = vi.mocked(AccessibilityInfo.sendAccessibilityEvent);
    // Like Cancel, focus returns to the 18+ slot's button (by then it reads Saving…) instead of being lost with the dialog.
    const [slotTarget, slotEvent] = focusEvents.mock.calls.at(-1) ?? [];
    expect(slotEvent).toBe("focus");
    expect((slotTarget as unknown as { props: Record<string, unknown> }).props.accessibilityHint).toBe(
      "Asks you to confirm first. Needed for buying later.",
    );

    pending.resolve({ ok: true, status: { age16Confirmed: true, age18Confirmed: true, canPurchase: true } });
    await screen.rerender();
    const row = screen.findAllByType("View").find((view) => textOf(view) === `✓${CONFIRMED}`);
    expect(row?.props.accessible).toBe(true);
    // No live region and no iOS announcement on top of the focus move, so the row is read once (no double read).
    expect(row?.props.accessibilityLiveRegion).toBeUndefined();
    expect(focusEvents.mock.calls.at(-1)).toEqual([row, "focus"]);
    await screen.rerender();
    expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
    Platform.OS = "android";
  });

  it("round 4 item 3: after Yes, Delete account then Cancel does not move focus to the confirmed row again", async () => {
    harness.state.adultResult = Promise.resolve({ ok: true, status: { age16Confirmed: true, age18Confirmed: true, canPurchase: true } });
    const screen = await harness.render();
    await screen.press(CONFIRM);
    await screen.press(DIALOG_YES);
    await screen.rerender();
    const focusEvents = vi.mocked(AccessibilityInfo.sendAccessibilityEvent);
    const isConfirmedRow = (target: unknown) => textOf(target as never) === `✓${CONFIRMED}`;
    expect(focusEvents.mock.calls.filter(([target]) => isConfirmedRow(target))).toHaveLength(1);

    await screen.press("Delete account");
    await screen.press("Cancel");
    await screen.rerender();
    expect(focusEvents.mock.calls.filter(([target]) => isConfirmedRow(target))).toHaveLength(1);
    expect(textOf(focusEvents.mock.calls.at(-1)?.[0] as never)).toBe("Delete account");
  });

  it("delta 1: an account already confirmed on load is not announced and does not take focus", async () => {
    Platform.OS = "ios";
    vi.mocked(AccessibilityInfo.announceForAccessibility).mockClear();
    harness.state.ageStatusResult = Promise.resolve({ ok: true, status: { age16Confirmed: true, age18Confirmed: true, canPurchase: true } });
    const screen = await harness.render();
    const row = screen.findAllByType("View").find((view) => textOf(view) === `✓${CONFIRMED}`);
    expect(row?.props.accessibilityLiveRegion).toBeUndefined();
    expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
    expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();
    Platform.OS = "android";
  });
});
