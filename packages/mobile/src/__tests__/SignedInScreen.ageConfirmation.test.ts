import { beforeEach, describe, expect, it } from "vitest";
import type { AgeConfirmationResult } from "../auth/accountActions";
import { FAILURE_MESSAGES } from "../auth/signInActions";
import { createSignedInScreenHarness, deferred } from "./signedInScreenHarness";

const CONFIRM = "Confirm I am 18 or older";
const CONFIRMED = "You confirmed you are 18 or older.";

describe("SignedInScreen 18+ confirmation (HEN-263)", () => {
  let harness: ReturnType<typeof createSignedInScreenHarness>;

  beforeEach(() => {
    harness = createSignedInScreenHarness();
  });

  it("offers 'Confirm I am 18 or older' in the Account section, says it cannot be undone, and records it once", async () => {
    const screen = await harness.render();
    expect(harness.state.ageReads).toBe(1);
    expect(screen.getPressable(CONFIRM).props).toMatchObject({
      accessibilityRole: "button",
      accessibilityHint: "Records that you are 18 or older so you can buy in the app. Only deleting your account undoes this.",
    });

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
  });

  it("shows the confirmed line instead of the button when the account already confirmed 18+", async () => {
    harness.state.ageStatusResult = Promise.resolve({ ok: true, status: { age16Confirmed: true, age18Confirmed: true, canPurchase: true } });
    const screen = await harness.render();

    expect(screen.text()).toContain(CONFIRMED);
    expect(screen.queryByText(CONFIRM)).toBeNull();
  });

  it("a failed save shows a plain message and keeps the button for a retry; an unread status shows neither", async () => {
    harness.state.adultResult = Promise.resolve({ ok: false, reason: "network", message: FAILURE_MESSAGES.network });
    const screen = await harness.render();
    await screen.press(CONFIRM);
    expect(screen.text()).toContain(`We could not save that. ${FAILURE_MESSAGES.network}`);
    expect(screen.getPressable(CONFIRM)).toBeDefined();

    harness.state.ageStatusResult = Promise.resolve({ ok: false, reason: "network", message: FAILURE_MESSAGES.network });
    const unread = await harness.render();
    expect(unread.queryByText(CONFIRM)).toBeNull();
    expect(unread.text()).not.toContain(CONFIRMED);
  });
});
