// HEN-305, one message at a time (Sara via Vera): an offline export on the delete confirm clears an earlier red code error,
// so the grey note never shows next to red (Bill's gate probe, Q1).
import { describe, expect, it } from "vitest";
import type { AccountCodeResult, AccountExportResult } from "../auth/accountActions";
import { FAILURE_MESSAGES } from "../auth/signInActions";
import { SERVER_UNREACHABLE_NOTE } from "../screens/ServerUnreachableNote";
import { createSignedInScreenHarness } from "./signedInScreenHarness";

const offline = { ok: false, reason: "network", message: FAILURE_MESSAGES.network } as const;
const rateLimited = { ok: false, reason: "rateLimited", message: FAILURE_MESSAGES.rateLimited } as const;

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
});
