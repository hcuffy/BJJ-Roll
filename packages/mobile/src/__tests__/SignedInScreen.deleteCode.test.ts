import { AccessibilityInfo } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountCodeResult, AccountDeletionResult } from "../auth/accountActions";
import { FAILURE_MESSAGES } from "../auth/signInActions";
import { colours } from "../theme/tokens";
import { flattenStyle, textOf } from "./screenHarness";
import { createSignedInScreenHarness, deferred } from "./signedInScreenHarness";

const DELETE_HINT = "Deletes your account now and signs you out.";

describe("SignedInScreen delete with a fresh email code (HEN-65, Henry's decision a)", () => {
  let harness: ReturnType<typeof createSignedInScreenHarness>;
  let state: ReturnType<typeof createSignedInScreenHarness>["state"];

  beforeEach(() => {
    harness = createSignedInScreenHarness();
    state = harness.state;
  });

  it("asks for a code before delete: Email me a code requests one and opens the code step; nothing is deleted yet", async () => {
    const screen = await harness.renderAtCodeStep();

    expect(state.codeRequests).toBe(1);
    expect(state.deletedCodes).toEqual([]);
    expect(screen.text()).toContain("Enter the code we emailed you");
    expect(screen.text()).toContain("We sent a 6-digit code to your email. It deletes your account at once, with no undo.");
    expect(screen.getByLabelText("6-digit code").props).toMatchObject({ keyboardType: "number-pad", maxLength: 6, textContentType: "oneTimeCode" });
    expect(screen.getPressable("Delete my account").props.accessibilityHint).toBe(DELETE_HINT);
  });

  it("Delete my account stays disabled until 6 digits, never deletes on its own, and sends the typed code", async () => {
    const screen = await harness.renderAtCodeStep();
    expect(screen.isDisabled("Delete my account")).toBe(true);

    await screen.changeText("6-digit code", "12345");
    expect(screen.isDisabled("Delete my account")).toBe(true);
    await screen.press("Delete my account");
    expect(state.deletedCodes).toEqual([]);

    await screen.changeText("6-digit code", "654321");
    expect(state.deletedCodes).toEqual([]);
    expect(screen.isDisabled("Delete my account")).toBe(false);
    await screen.press("Delete my account");
    expect(state.deletedCodes).toEqual(["654321"]);
    expect(state.deletedCalls).toBe(1);
  });

  it("the code step's danger pill is filled red with the dark #111313 label", async () => {
    const screen = await harness.renderAtCodeStep();
    await screen.changeText("6-digit code", "654321");

    expect(flattenStyle(screen.getPressable("Delete my account").props.style)).toMatchObject({ backgroundColor: colours.danger });
    expect(flattenStyle(screen.queryByText("Delete my account")?.props.style)).toMatchObject({ color: colours.onPrimary });
  });

  it("a double tap deletes once and shows progress; Cancel and Send a new code are blocked meanwhile", async () => {
    const pending = deferred<AccountDeletionResult>();
    state.deleteResult = pending.promise;
    const screen = await harness.renderAtCodeStep();
    await screen.changeText("6-digit code", "654321");

    const confirm = screen.getPressable("Delete my account");
    (confirm.props.onPress as () => void)();
    (confirm.props.onPress as () => void)();
    await screen.rerender();
    expect(screen.text()).toContain("Deleting account…");
    expect(screen.isDisabled("Cancel")).toBe(true);
    expect(screen.isDisabled("Send a new code")).toBe(true);

    pending.resolve({ ok: true });
    await screen.rerender();
    expect(state.deletedCodes).toEqual(["654321"]);
    expect(state.deletedCalls).toBe(1);
  });

  it("a wrong or expired code shows a field error, keeps the account, and a new code can be sent and used", async () => {
    state.deleteResult = Promise.resolve({ ok: false, reason: "invalidCode", message: FAILURE_MESSAGES.invalidCode });
    const screen = await harness.renderAtCodeStep();
    await screen.changeText("6-digit code", "000000");
    await screen.press("Delete my account");

    expect(state.deletedCalls).toBe(0);
    expect(screen.getByLabelText("6-digit code").props.accessibilityHint).toBe(FAILURE_MESSAGES.invalidCode);
    expect(screen.queryByText(FAILURE_MESSAGES.invalidCode)?.props).toMatchObject({ accessibilityRole: "alert" });

    await screen.press("Send a new code");
    expect(state.codeRequests).toBe(2);
    expect(screen.text()).toContain("We sent a new code to your email.");
    expect(screen.text()).not.toContain(FAILURE_MESSAGES.invalidCode);

    state.deleteResult = Promise.resolve({ ok: true });
    await screen.changeText("6-digit code", "111111");
    await screen.press("Delete my account");
    expect(state.deletedCodes).toEqual(["000000", "111111"]);
    expect(state.deletedCalls).toBe(1);
  });

  it("other failures (not the network) say the account was not deleted and stay on the code step", async () => {
    state.deleteResult = Promise.resolve({ ok: false, reason: "unknown", message: FAILURE_MESSAGES.unknown });
    const screen = await harness.renderAtCodeStep();
    await screen.changeText("6-digit code", "654321");
    await screen.press("Delete my account");

    expect(state.deletedCalls).toBe(0);
    expect(screen.queryByText(`Your account was not deleted. ${FAILURE_MESSAGES.unknown}`)?.props).toMatchObject({ accessibilityRole: "alert" });
    expect(screen.text()).toContain("Enter the code we emailed you");
  });

  it("a failed code request stays on the confirm step with a plain message, and retries", async () => {
    state.codeResult = Promise.resolve<AccountCodeResult>({ ok: false, reason: "rateLimited", message: FAILURE_MESSAGES.rateLimited });
    const screen = await harness.render();
    await screen.press("Delete account");
    await screen.press("Email me a code");

    expect(screen.queryByText(`We could not send the code. ${FAILURE_MESSAGES.rateLimited}`)?.props).toMatchObject({ accessibilityRole: "alert" });
    expect(screen.text()).toContain("Delete your account?");
    expect(screen.queryByText("Delete my account")).toBeNull();

    state.codeResult = Promise.resolve<AccountCodeResult>({ ok: true });
    await screen.press("Email me a code");
    expect(state.codeRequests).toBe(2);
    expect(screen.text()).toContain("Enter the code we emailed you");
  });

  it("a failed resend shows why, never 'We sent a new code', and clears an earlier sent notice", async () => {
    const screen = await harness.renderAtCodeStep();
    await screen.press("Send a new code");
    expect(screen.text()).toContain("We sent a new code to your email.");

    state.codeResult = Promise.resolve<AccountCodeResult>({ ok: false, reason: "rateLimited", message: FAILURE_MESSAGES.rateLimited });
    await screen.press("Send a new code");

    expect(state.codeRequests).toBe(3);
    expect(screen.text()).not.toContain("We sent a new code");
    expect(screen.queryByText(`We could not send the code. ${FAILURE_MESSAGES.rateLimited}`)?.props).toMatchObject({ accessibilityRole: "alert" });
    expect(screen.text()).toContain("Enter the code we emailed you");
    expect(state.deletedCalls).toBe(0);
  });

  it("a11y: the code step moves focus to its heading; Cancel returns to Delete account without deleting", async () => {
    const screen = await harness.renderAtCodeStep();
    const focusEvents = vi.mocked(AccessibilityInfo.sendAccessibilityEvent);
    const [headingTarget, headingEvent] = focusEvents.mock.calls.at(-1) ?? [];
    expect(headingEvent).toBe("focus");
    expect(textOf(headingTarget as never)).toBe("Enter the code we emailed you");

    await screen.press("Cancel");
    expect(state.deletedCodes).toEqual([]);
    expect(focusEvents.mock.calls.at(-1)?.[0]).toBe(screen.getPressable("Delete account"));
  });
});
