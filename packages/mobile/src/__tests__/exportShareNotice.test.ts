import { SIGN_UP_ATTESTATION_TEXT_VERSION } from "@bjj-roll/shared";
import { createElement } from "react";
import { Platform, Share, Text } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountCodeResult, AccountDeletionResult, AccountExportResult, SignUpAttestationResult } from "../auth/accountActions";
import { SignUpAttestationGate } from "../screens/SignUpAttestationGate";
import { colours } from "../theme/tokens";
import { flattenStyle, renderScreen } from "./screenHarness";
import { createSignedInScreenHarness, EXPORT_JSON } from "./signedInScreenHarness";

const SHARED = "Your data export was shared.";
type Screen = Awaited<ReturnType<typeof renderScreen>>;
interface ShareResult {
  readonly action: "sharedAction" | "dismissedAction";
}

/** A gated account on its delete confirm, so "Export my data first" shows. */
async function renderGateConfirm(): Promise<Screen> {
  const prompt: SignUpAttestationResult = {
    ok: true,
    status: { required: true, currentTextVersionId: SIGN_UP_ATTESTATION_TEXT_VERSION.id, acceptedTextVersionId: null },
  };
  const screen = await renderScreen(
    createElement(
      SignUpAttestationGate,
      {
        onReadStatus: () => Promise.resolve(prompt),
        onAccept: () => Promise.resolve(prompt),
        onSignOut: () => undefined,
        onExportData: () => Promise.resolve<AccountExportResult>({ ok: true, json: EXPORT_JSON }),
        onRequestDeleteCode: () => Promise.resolve<AccountCodeResult>({ ok: true }),
        onDeleteAccount: () => Promise.resolve<AccountDeletionResult>({ ok: true }),
        onAccountDeleted: () => undefined,
      },
      createElement(Text, null, "Account content"),
    ),
  );
  await screen.press("Delete account");
  return screen;
}

const signedInMain = async () => [await createSignedInScreenHarness().render(), "Export my data"] as const;
const signedInConfirm = async () => {
  const screen = await createSignedInScreenHarness().render();
  await screen.press("Delete account");
  return [screen, "Export my data first"] as const;
};
const gateConfirm = async () => [await renderGateConfirm(), "Export my data first"] as const;
const places = [
  ["the signed-in screen", signedInMain],
  ["the signed-in delete confirm", signedInConfirm],
  ["the attestation gate's delete confirm", gateConfirm],
] as const;

/** HEN-311 (Vera, HEN-308 review): after the share sheet closes, say so only when iOS reports the share completed. */
describe("export share confirmation (HEN-311)", () => {
  const exportWith = async (open: () => Promise<readonly [Screen, string]>, platform: "ios" | "android", share: ShareResult) => {
    Platform.OS = platform;
    const [screen, title] = await open();
    vi.spyOn(Share, "share").mockResolvedValue(share);
    await screen.press(title);
    return screen;
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it.each(places)("on %s: an iOS share that completed shows the grey polite confirmation", async (_place, open) => {
    const screen = await exportWith(open, "ios", { action: "sharedAction" });

    const line = screen.queryByText(SHARED);
    expect(line?.props).toMatchObject({ accessibilityLiveRegion: "polite" });
    expect(line?.props.accessibilityRole).toBeUndefined();
    expect(flattenStyle(line?.props.style).color).toBe(colours.textSecondary);
  });

  it.each(places)("on %s: a cancelled iOS share shows nothing, and clears an earlier confirmation", async (_place, open) => {
    const screen = await exportWith(open, "ios", { action: "sharedAction" });
    expect(screen.text()).toContain(SHARED);
    vi.spyOn(Share, "share").mockResolvedValue({ action: "dismissedAction" });
    await screen.press(screen.text().includes("Export my data first") ? "Export my data first" : "Export my data");

    expect(screen.text()).not.toContain(SHARED);
  });

  // Android always reports sharedAction, so it never claims shared. Its neutral line waits for Vera's wording (open question).
  it.each(places)("on %s: Android never says the export was shared", async (_place, open) => {
    const screen = await exportWith(open, "android", { action: "sharedAction" });

    expect(screen.text()).not.toContain(SHARED);
  });
});
