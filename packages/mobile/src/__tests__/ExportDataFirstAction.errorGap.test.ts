import { signUpAttestationVersion } from "@bjj-roll/shared";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import type { AccountCodeResult, AccountDeletionResult, AccountExportResult, SignUpAttestationResult } from "../auth/accountActions";
import { failureMessages } from "../auth/signInActions";
import { SignUpAttestationGate } from "../screens/SignUpAttestationGate";
import { flattenStyle, type HostNode, renderScreen } from "./screenHarness";

const contains = (node: HostNode, target: HostNode): boolean =>
  node === target || node.children.some((child) => typeof child !== "string" && contains(child, target));

describe("Export my data first spacing to its own error", () => {
  it("on the attestation gate, a failed export's error sits 16 below the button, inside the export row", async () => {
    const screen = await renderScreen(
      createElement(SignUpAttestationGate, {
        onReadStatus: () =>
          Promise.resolve<SignUpAttestationResult>({
            ok: true,
            status: { required: true, currentTextVersionId: signUpAttestationVersion.id, acceptedTextVersionId: null },
          }),
        onAccept: () => Promise.reject(new Error("not used")),
        onSignOut: () => undefined,
        onExportData: () => Promise.resolve<AccountExportResult>({ ok: false, reason: "rateLimited", message: failureMessages.rateLimited }),
        onRequestDeleteCode: () => Promise.resolve<AccountCodeResult>({ ok: true }),
        onDeleteAccount: () => Promise.resolve<AccountDeletionResult>({ ok: true }),
        onAccountDeleted: () => undefined,
      }),
    );
    await screen.press("Delete account");
    await screen.press("Export my data first");

    const button = screen.getPressable("Export my data first");
    const error = screen.queryByText(`Export failed. ${failureMessages.rateLimited}`);
    expect(error).not.toBeNull();
    const row = screen
      .findAllByType("View")
      .filter((view) => contains(view, button) && contains(view, error as HostNode))
      .find((view) => view.children.length === 2);
    expect(row).toBeDefined();
    expect(Number(flattenStyle(row?.props.style).gap ?? 0)).toBe(16);
  });
});
