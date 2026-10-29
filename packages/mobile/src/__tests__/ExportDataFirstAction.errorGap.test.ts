// Vera (HEN-308): 16 between "Export my data first" and its own error, inside the export row (ab46d10 moved that gap into
// the ExportDataFirstAction wrapper). The design test only checks the 24 below the row.
import { SIGN_UP_ATTESTATION_TEXT_VERSION } from "@bjj-roll/shared";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import type { AccountCodeResult, AccountDeletionResult, AccountExportResult, SignUpAttestationResult } from "../auth/accountActions";
import { FAILURE_MESSAGES } from "../auth/signInActions";
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
            status: { required: true, currentTextVersionId: SIGN_UP_ATTESTATION_TEXT_VERSION.id, acceptedTextVersionId: null },
          }),
        onAccept: () => Promise.reject(new Error("not used")),
        onSignOut: () => undefined,
        onExportData: () => Promise.resolve<AccountExportResult>({ ok: false, reason: "rateLimited", message: FAILURE_MESSAGES.rateLimited }),
        onRequestDeleteCode: () => Promise.resolve<AccountCodeResult>({ ok: true }),
        onDeleteAccount: () => Promise.resolve<AccountDeletionResult>({ ok: true }),
        onAccountDeleted: () => undefined,
      }),
    );
    await screen.press("Delete account");
    await screen.press("Export my data first");

    const button = screen.getPressable("Export my data first");
    const error = screen.queryByText(`Export failed. ${FAILURE_MESSAGES.rateLimited}`);
    expect(error).not.toBeNull();
    const row = screen
      .findAllByType("View")
      .filter((view) => contains(view, button) && contains(view, error as HostNode))
      .find((view) => view.children.length === 2);
    expect(row).toBeDefined();
    expect(Number(flattenStyle(row?.props.style).gap ?? 0)).toBe(16);
  });
});
