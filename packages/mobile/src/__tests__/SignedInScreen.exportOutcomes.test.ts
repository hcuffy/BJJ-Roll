// HEN-311 after #93: an offline export shows only the grey note, and Delete account stays startable after any export outcome.
import { Platform, Share } from "react-native";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AccountExportResult } from "../auth/accountActions";
import { FAILURE_MESSAGES } from "../auth/signInActions";
import { EXPORT_CREATED_NOTICE, EXPORT_SHARED_NOTICE } from "../screens/ExportDataFirstAction";
import { SERVER_UNREACHABLE_NOTE } from "../screens/ServerUnreachableNote";
import type { renderScreen } from "./screenHarness";
import { createSignedInScreenHarness } from "./signedInScreenHarness";

type Screen = Awaited<ReturnType<typeof renderScreen>>;
type Os = "ios" | "android";

const offline: AccountExportResult = { ok: false, reason: "network", message: FAILURE_MESSAGES.network };
const failed: AccountExportResult = { ok: false, reason: "rateLimited", message: "Too many tries." };
const SEND_CODE = "Email me a code";

describe("SignedInScreen export outcomes (HEN-311)", () => {
  const startOs = Platform.OS;
  let harness: ReturnType<typeof createSignedInScreenHarness>;

  beforeEach(() => {
    harness = createSignedInScreenHarness();
  });
  afterEach(() => {
    Platform.OS = startOs;
  });

  const expectNoteOnly = (screen: Screen) => {
    expect(screen.text()).toContain(SERVER_UNREACHABLE_NOTE);
    expect(screen.text()).not.toContain(EXPORT_CREATED_NOTICE);
    expect(screen.text()).not.toContain(EXPORT_SHARED_NOTICE);
    expect(harness.state.shareSpy).not.toHaveBeenCalled();
  };

  it.each<Os>(["android", "ios"])("%s: an offline export shows the grey note only, never the created or shared line", async (platform) => {
    Platform.OS = platform;
    harness.state.exportResult = Promise.resolve(offline);
    const screen = await harness.render();
    await screen.press("Export my data");
    expectNoteOnly(screen);
  });

  it("android: an offline Export my data first on the delete confirm shows the grey note only", async () => {
    Platform.OS = "android";
    harness.state.exportResult = Promise.resolve(offline);
    const screen = await harness.render();
    await screen.press("Delete account");
    await screen.press("Export my data first");
    expectNoteOnly(screen);
  });

  const outcomes: [string, Os, () => void][] = [
    ["shared (iOS)", "ios", () => undefined],
    ["created (Android)", "android", () => undefined],
    ["cancelled", "ios", () => harness.state.shareSpy.mockResolvedValue({ action: Share.dismissedAction })],
    ["share sheet error", "ios", () => harness.state.shareSpy.mockRejectedValue(new Error("no sheet"))],
    ["failed", "android", () => (harness.state.exportResult = Promise.resolve(failed))],
    ["offline", "android", () => (harness.state.exportResult = Promise.resolve(offline))],
  ];

  it.each(outcomes)("after an export that ends %s, Delete account starts and the code can be sent", async (_outcome, platform, arrange) => {
    Platform.OS = platform;
    const screen = await harness.render();
    arrange();
    await screen.press("Export my data");
    expect(screen.isDisabled("Delete account")).toBe(false);
    await screen.press("Delete account");
    expect(screen.isDisabled(SEND_CODE)).toBe(false);
  });

  it.each(outcomes)("on the delete confirm, after Export my data first ends %s, the code can still be sent", async (_outcome, platform, arrange) => {
    Platform.OS = platform;
    const screen = await harness.render();
    await screen.press("Delete account");
    arrange();
    await screen.press("Export my data first");
    expect(screen.isDisabled(SEND_CODE)).toBe(false);
    await screen.press(SEND_CODE);
    expect(harness.state.codeRequests).toBe(1);
  });
});
