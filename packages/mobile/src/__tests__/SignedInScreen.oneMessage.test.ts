import { describe, expect, it } from "vitest";
import type { AccountCodeResult, AccountDeletionResult, AccountExportResult, AgeConfirmationResult } from "../auth/accountActions";
import { FAILURE_MESSAGES } from "../auth/signInActions";
import { SERVER_UNREACHABLE_NOTE } from "../screens/ServerUnreachableNote";
import type { renderScreen } from "./screenHarness";
import { createSignedInScreenHarness, deferred } from "./signedInScreenHarness";

const offline = { ok: false, reason: "network", message: FAILURE_MESSAGES.network } as const;
const rateLimited = { ok: false, reason: "rateLimited", message: FAILURE_MESSAGES.rateLimited } as const;
const unknown = { ok: false, reason: "unknown", message: FAILURE_MESSAGES.unknown } as const;
const ADULT_ERROR = `We could not save that. ${FAILURE_MESSAGES.unknown}`;
const EXPORT_ERROR = `Export failed. ${FAILURE_MESSAGES.unknown}`;

type Screen = Awaited<ReturnType<typeof renderScreen>>;

function alerts(screen: Screen) {
  return screen.findAllByType("Text").filter((node) => node.props.accessibilityRole === "alert");
}

async function confirmAdult(screen: Screen) {
  await screen.press("Confirm I am 18 or older");
  await screen.press("Yes, I am 18 or older");
}

describe("SignedInScreen delete confirm: one message at a time (HEN-305)", () => {
  it("place 2 after place 3: a red code error, then an offline Export my data first, shows the note alone (Bill, gate Q1)", async () => {
    const harness = createSignedInScreenHarness();
    const { state } = harness;
    state.codeResult = Promise.resolve<AccountCodeResult>(rateLimited);
    const screen = await harness.render();
    await screen.press("Delete account");
    await screen.press("Email me a code");
    expect(screen.text()).toContain(`We could not send the code. ${FAILURE_MESSAGES.rateLimited}`);

    state.exportResult = Promise.resolve<AccountExportResult>(offline);
    await screen.press("Export my data first");
    expect(screen.text()).toContain(SERVER_UNREACHABLE_NOTE);
    expect(screen.text()).not.toContain("We could not send the code.");
    expect(screen.queryByText(SERVER_UNREACHABLE_NOTE)?.props.accessibilityRole).toBeUndefined();
    expect(screen.findAllByType("Text").filter((node) => node.props.accessibilityRole === "alert")).toEqual([]);
  });

  it("a red 18+ error, then an offline Export my data, shows only the grey note (Vera fix 1)", async () => {
    const harness = createSignedInScreenHarness();
    harness.state.adultResult = Promise.resolve<AgeConfirmationResult>(unknown);
    const screen = await harness.render();
    await confirmAdult(screen);
    expect(screen.text()).toContain(ADULT_ERROR);

    harness.state.exportResult = Promise.resolve<AccountExportResult>(offline);
    await screen.press("Export my data");
    expect(screen.text()).toContain(SERVER_UNREACHABLE_NOTE);
    expect(screen.text()).not.toContain("We could not save that.");
    expect(alerts(screen)).toEqual([]);
  });

  it("the 18+ tap clears a red export error, and Delete account clears a red 18+ error (Vera fix 1)", async () => {
    const harness = createSignedInScreenHarness();
    harness.state.exportResult = Promise.resolve<AccountExportResult>(unknown);
    harness.state.adultResult = Promise.resolve<AgeConfirmationResult>(unknown);
    const screen = await harness.render();
    await screen.press("Export my data");
    expect(screen.text()).toContain(EXPORT_ERROR);

    await confirmAdult(screen);
    expect(screen.text()).not.toContain(EXPORT_ERROR);
    expect(screen.text()).toContain(ADULT_ERROR);

    await screen.press("Delete account");
    await screen.press("Cancel");
    expect(alerts(screen)).toEqual([]);
  });

  it("Email me a code: the note clears while the next request is pending and comes back on a repeat failure", async () => {
    const harness = createSignedInScreenHarness();
    harness.state.codeResult = Promise.resolve<AccountCodeResult>(offline);
    const screen = await harness.render();
    await screen.press("Delete account");
    await screen.press("Email me a code");
    expect(screen.text()).toContain(SERVER_UNREACHABLE_NOTE);

    const pending = deferred<AccountCodeResult>();
    harness.state.codeResult = pending.promise;
    (screen.getPressable("Email me a code").props.onPress as () => void)();
    await screen.rerender();
    expect(screen.text()).not.toContain(SERVER_UNREACHABLE_NOTE);
    pending.resolve(offline);
    await screen.rerender();
    expect(screen.text()).toContain(SERVER_UNREACHABLE_NOTE);
  });

  it("Delete my account: the note clears while the next request is pending and comes back on a repeat failure", async () => {
    const harness = createSignedInScreenHarness();
    harness.state.deleteResult = Promise.resolve<AccountDeletionResult>(offline);
    const screen = await harness.renderAtCodeStep();
    await screen.changeText("6-digit code", "654321");
    await screen.press("Delete my account");
    expect(screen.text()).toContain(SERVER_UNREACHABLE_NOTE);

    const pending = deferred<AccountDeletionResult>();
    harness.state.deleteResult = pending.promise;
    (screen.getPressable("Delete my account").props.onPress as () => void)();
    await screen.rerender();
    expect(screen.text()).not.toContain(SERVER_UNREACHABLE_NOTE);
    pending.resolve(offline);
    await screen.rerender();
    expect(screen.text()).toContain(SERVER_UNREACHABLE_NOTE);
  });
});
