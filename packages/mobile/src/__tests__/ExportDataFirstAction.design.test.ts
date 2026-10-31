import { signUpAttestationVersion } from "@bjj-roll/shared";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import type { AccountCodeResult, AccountDeletionResult, AccountExportResult, SignUpAttestationResult } from "../auth/accountActions";
import { SignUpAttestationGate } from "../screens/SignUpAttestationGate";
import { flattenStyle, type HostNode, renderScreen } from "./screenHarness";
import { createSignedInScreenHarness, EXPORT_JSON } from "./signedInScreenHarness";

type Screen = Awaited<ReturnType<typeof renderScreen>>;

const contains = (node: HostNode, target: HostNode): boolean =>
  node === target || node.children.some((child) => typeof child !== "string" && contains(child, target));

async function gateConfirm(): Promise<Screen> {
  const screen = await renderScreen(
    createElement(SignUpAttestationGate, {
      onReadStatus: () =>
        Promise.resolve<SignUpAttestationResult>({
          ok: true,
          status: { required: true, currentTextVersionId: signUpAttestationVersion.id, acceptedTextVersionId: null },
        }),
      onAccept: () => Promise.reject(new Error("not used")),
      onSignOut: () => undefined,
      onExportData: () => Promise.resolve<AccountExportResult>({ ok: true, json: EXPORT_JSON }),
      onRequestDeleteCode: () => Promise.resolve<AccountCodeResult>({ ok: true }),
      onDeleteAccount: () => Promise.resolve<AccountDeletionResult>({ ok: true }),
      onAccountDeleted: () => undefined,
    }),
  );
  await screen.press("Delete account");
  return screen;
}

async function signedInConfirm(): Promise<Screen> {
  const screen = await createSignedInScreenHarness().render();
  await screen.press("Delete account");
  return screen;
}

describe("Export my data first spacing on the delete confirm", () => {
  it.each([
    ["the attestation gate", gateConfirm],
    ["the signed-in screen", signedInConfirm],
  ] as const)("on %s, the export sits 24 above Email me a code", async (_case, open) => {
    const screen = await open();
    const emailCode = screen.getPressable("Email me a code");
    const actions = screen.findAllByType("View").find((view) => view.children.includes(emailCode));
    const exportRow = actions?.children.find(
      (child): child is HostNode => typeof child !== "string" && contains(child, screen.getPressable("Export my data first")),
    );

    expect(exportRow).toBeDefined();
    expect(exportRow).not.toBe(emailCode);
    const gap = Number(flattenStyle(actions?.props.style).gap ?? 0);
    const below = Number(flattenStyle(exportRow?.props.style).marginBottom ?? 0);
    expect(gap + below).toBe(24);
    expect(actions?.children.indexOf(exportRow as HostNode)).toBe((actions?.children.indexOf(emailCode) ?? 0) - 1);
  });
});
