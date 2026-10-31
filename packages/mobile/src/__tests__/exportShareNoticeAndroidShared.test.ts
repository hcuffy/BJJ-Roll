import { signUpAttestationVersion } from "@bjj-roll/shared";
import { createElement } from "react";
import { Platform, Share, Text } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountCodeResult, AccountDeletionResult, AccountExportResult, SignUpAttestationResult } from "../auth/accountActions";
import { SignUpAttestationGate } from "../screens/SignUpAttestationGate";
import { colours } from "../theme/tokens";
import { flattenStyle, renderScreen } from "./screenHarness";
import { createSignedInScreenHarness, EXPORT_JSON } from "./signedInScreenHarness";

const SHARED = "Your data export was shared.";
const CREATED = "Your data export was created. Check that you saved a copy.";
type Screen = Awaited<ReturnType<typeof renderScreen>>;

async function renderGateConfirm(): Promise<Screen> {
  const prompt: SignUpAttestationResult = {
    ok: true,
    status: { required: true, currentTextVersionId: signUpAttestationVersion.id, acceptedTextVersionId: null },
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

describe("export share line per platform (HEN-311 gate)", () => {
  type Action = "sharedAction" | "dismissedAction";
  const exportWith = async (open: () => Promise<readonly [Screen, string]>, platform: "ios" | "android", action: Action) => {
    Platform.OS = platform;
    const [screen, title] = await open();
    vi.spyOn(Share, "share").mockResolvedValue({ action });
    await screen.press(title);
    return screen;
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it.each(places)("on %s: Android reporting sharedAction (also its cancel) shows the grey created line, never 'shared'", async (_place, open) => {
    const screen = await exportWith(open, "android", "sharedAction");

    const line = screen.queryByText(CREATED);
    expect(line?.props).toMatchObject({ accessibilityLiveRegion: "polite" });
    expect(line?.props.accessibilityRole).toBeUndefined();
    expect(flattenStyle(line?.props.style).color).toBe(colours.textSecondary);
    expect(screen.text()).not.toContain(SHARED);
  });

  it.each(places)("on %s: a dismissed iOS share shows no line at all, never the Android created line", async (_place, open) => {
    const screen = await exportWith(open, "ios", "dismissedAction");

    expect(screen.text()).not.toContain(CREATED);
    expect(screen.text()).not.toContain(SHARED);
  });

  it.each(places)("on %s: a completed iOS share never shows the Android created line", async (_place, open) => {
    const screen = await exportWith(open, "ios", "sharedAction");

    expect(screen.text()).toContain(SHARED);
    expect(screen.text()).not.toContain(CREATED);
  });
});
