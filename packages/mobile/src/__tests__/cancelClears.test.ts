import { describe, expect, it } from "vitest";
import type { AccountCodeResult, AccountExportResult } from "../auth/accountActions";
import { failureMessages } from "../auth/signInActions";
import { SERVER_UNREACHABLE_NOTE } from "../screens/ServerUnreachableNote";
import type { renderScreen } from "./screenHarness";
import { createSignedInScreenHarness } from "./signedInScreenHarness";

const offline = { ok: false, reason: "network", message: failureMessages.network } as const;
const unknown = { ok: false, reason: "unknown", message: failureMessages.unknown } as const;
type Screen = Awaited<ReturnType<typeof renderScreen>>;

function alerts(screen: Screen) {
  return screen.findAllByType("Text").filter((node) => node.props.accessibilityRole === "alert");
}

describe("SignedInScreen delete confirm: Cancel drops its messages (HEN-305)", () => {
  it("an offline Email me a code, then Cancel: the main screen has no note", async () => {
    const harness = createSignedInScreenHarness();
    harness.state.codeResult = Promise.resolve<AccountCodeResult>(offline);
    const screen = await harness.render();
    await screen.press("Delete account");
    await screen.press("Email me a code");
    expect(screen.text()).toContain(SERVER_UNREACHABLE_NOTE);

    await screen.press("Cancel");
    expect(screen.text()).toContain("Export my data");
    expect(screen.text()).not.toContain(SERVER_UNREACHABLE_NOTE);
    expect(alerts(screen)).toEqual([]);
  });

  it("an offline Export my data first, then Cancel: the main screen has no note", async () => {
    const harness = createSignedInScreenHarness();
    harness.state.exportResult = Promise.resolve<AccountExportResult>(offline);
    const screen = await harness.render();
    await screen.press("Delete account");
    await screen.press("Export my data first");
    expect(screen.text()).toContain(SERVER_UNREACHABLE_NOTE);

    await screen.press("Cancel");
    expect(screen.text()).not.toContain(SERVER_UNREACHABLE_NOTE);
  });

  it("a red Export my data first, then Cancel: the main screen has no red export error", async () => {
    const harness = createSignedInScreenHarness();
    harness.state.exportResult = Promise.resolve<AccountExportResult>(unknown);
    const screen = await harness.render();
    await screen.press("Delete account");
    await screen.press("Export my data first");
    expect(screen.text()).toContain(`Export failed. ${failureMessages.unknown}`);

    await screen.press("Cancel");
    expect(screen.text()).not.toContain("Export failed.");
    expect(alerts(screen)).toEqual([]);
  });
});
