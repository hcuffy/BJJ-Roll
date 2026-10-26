import { beforeEach, describe, expect, it } from "vitest";
import type { AgeConfirmationResult } from "../auth/accountActions";
import { FAILURE_MESSAGES } from "../auth/signInActions";
import { colours } from "../theme/tokens";
import { flattenStyle, textOf } from "./screenHarness";
import { createSignedInScreenHarness, deferred } from "./signedInScreenHarness";

const CONFIRM = "Confirm I am 18 or older";
const CONFIRMED = "18 or older: confirmed";
const CANT_UNDO = "You can't undo this, except by deleting your account.";

describe("SignedInScreen 18+ confirmation (HEN-263)", () => {
  let harness: ReturnType<typeof createSignedInScreenHarness>;

  beforeEach(() => {
    harness = createSignedInScreenHarness();
  });

  it("offers 'Confirm I am 18 or older' in the Account section, says visibly that it cannot be undone, and records it once", async () => {
    const screen = await harness.render();
    expect(harness.state.ageReads).toBe(1);
    expect(screen.getPressable(CONFIRM).props).toMatchObject({
      accessibilityRole: "button",
      accessibilityHint: "Records that you are 18 or older. Needed for buying later.",
    });
    const text = screen.text();
    expect(text.indexOf(CANT_UNDO)).toBeGreaterThan(text.indexOf(CONFIRM));
    expect(flattenStyle(screen.queryByText(CANT_UNDO)?.props.style).color).toBe(colours.textSecondary);

    const pending = deferred<AgeConfirmationResult>();
    harness.state.adultResult = pending.promise;
    const button = screen.getPressable(CONFIRM);
    (button.props.onPress as () => void)();
    (button.props.onPress as () => void)();
    await screen.rerender();
    pending.resolve({ ok: true, status: { age16Confirmed: true, age18Confirmed: true, canPurchase: true } });
    await screen.rerender();

    expect(harness.state.adultConfirmations).toBe(1);
    expect(screen.text()).toContain(CONFIRMED);
    expect(screen.queryByText(CONFIRM)).toBeNull();
    expect(screen.queryByText(CANT_UNDO)).toBeNull();
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
    harness.state.adultResult = Promise.resolve({ ok: false, reason: "network", message: FAILURE_MESSAGES.network });
    const screen = await harness.render();
    await screen.press(CONFIRM);
    expect(screen.text()).toContain(`We could not save that. ${FAILURE_MESSAGES.network}`);
    expect(screen.getPressable(CONFIRM)).toBeDefined();

    harness.state.ageStatusResult = Promise.resolve({ ok: false, reason: "network", message: FAILURE_MESSAGES.network });
    const unread = await harness.render();
    expect(unread.getPressable(CONFIRM)).toBeDefined();
    expect(unread.text()).toContain(CANT_UNDO);
    expect(unread.text()).not.toContain(CONFIRMED);
    expect(unread.queryByText("Checking…")).toBeNull();
  });
});
