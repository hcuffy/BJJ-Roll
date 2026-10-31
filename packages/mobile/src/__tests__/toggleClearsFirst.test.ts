import { beforeEach, describe, expect, it } from "vitest";
import type { BiometricCheck } from "../auth/biometricUnlock";
import { createSignedInScreenHarness, deferred } from "./signedInScreenHarness";

const TOGGLE = "Biometric unlock";
const EXPORT_ERROR = "Too many tries.";

describe("SignedInScreen: the biometric toggle clears other messages when it starts (HEN-311 gate)", () => {
  let harness: ReturnType<typeof createSignedInScreenHarness>;

  beforeEach(() => {
    harness = createSignedInScreenHarness();
    harness.state.exportResult = Promise.resolve({ ok: false, reason: "rateLimited", message: EXPORT_ERROR });
  });

  const tapToggleWhilePending = async (screen: Awaited<ReturnType<typeof harness.render>>) => {
    const pending = deferred<BiometricCheck>();
    harness.state.biometricChangeResult = pending.promise;
    (screen.getPressable(TOGGLE).props.onPress as () => void)();
    await screen.rerender();
    return pending;
  };

  it("turning it on: the export error is gone while the check is still pending", async () => {
    const screen = await harness.render();
    await screen.press("Export my data");
    expect(screen.text()).toContain(EXPORT_ERROR);

    const pending = await tapToggleWhilePending(screen);
    expect(screen.text()).not.toContain(EXPORT_ERROR);
    pending.resolve({ ok: true });
    await screen.rerender();
    expect(screen.text()).not.toContain(EXPORT_ERROR);
  });

  it("turning it off: the export error is gone while the check is still pending, and after it", async () => {
    const screen = await harness.render();
    await screen.press(TOGGLE);
    await screen.press("Export my data");
    expect(screen.text()).toContain(EXPORT_ERROR);

    const pending = await tapToggleWhilePending(screen);
    expect(screen.text()).not.toContain(EXPORT_ERROR);
    pending.resolve({ ok: true });
    await screen.rerender();
    expect(screen.text()).not.toContain(EXPORT_ERROR);
  });
});
