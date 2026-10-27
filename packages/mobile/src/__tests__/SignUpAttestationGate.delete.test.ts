import { SIGN_UP_ATTESTATION_LABEL, SIGN_UP_ATTESTATION_TEXT_VERSION } from "@bjj-roll/shared";
import { createElement } from "react";
import { AccessibilityInfo, Text } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountCodeResult, SignUpAttestationResult } from "../auth/accountActions";
import { FAILURE_MESSAGES } from "../auth/signInActions";
import { SignUpAttestationGate, TRY_AGAIN } from "../screens/SignUpAttestationGate";
import { SERVER_UNREACHABLE_NOTE } from "../screens/ServerUnreachableNote";
import { colours } from "../theme/tokens";
import { pressHardwareBack, resetBackListeners } from "./backHandlerHarness";
import { flattenStyle, type HostNode, renderScreen } from "./screenHarness";

const DELETE_ENTRY = "Delete account";
const CONFIRM_TITLE = "Delete your account?";
const EMAIL_CODE = "Email me a code";
const CODE_TITLE = "Enter the code we emailed you";
const prompt: SignUpAttestationResult = {
  ok: true,
  status: { required: true, currentTextVersionId: SIGN_UP_ATTESTATION_TEXT_VERSION.id, acceptedTextVersionId: null },
};
const readError: SignUpAttestationResult = { ok: false, reason: "unknown", message: FAILURE_MESSAGES.unknown };
const offline: AccountCodeResult = { ok: false, reason: "network", message: FAILURE_MESSAGES.network };
const rateLimited: AccountCodeResult = { ok: false, reason: "rateLimited", message: FAILURE_MESSAGES.rateLimited };
const gateScreens = [
  ["the re-accept prompt", prompt, SIGN_UP_ATTESTATION_LABEL],
  ["the status-read error screen", readError, TRY_AGAIN],
] as const;

/** A gated account (prompt or read error) with recording delete callbacks; each code request takes the next result. */
async function renderGate(read: SignUpAttestationResult, codeResults: AccountCodeResult[] = [{ ok: true }]) {
  const calls = { accepts: 0, deleteCodes: 0, deletes: [] as string[], deleted: 0 };
  const screen = await renderScreen(
    createElement(
      SignUpAttestationGate,
      {
        onReadStatus: () => Promise.resolve(read),
        onAccept: () => {
          calls.accepts += 1;
          return Promise.resolve(prompt);
        },
        onSignOut: () => undefined,
        onRequestDeleteCode: () => Promise.resolve(codeResults[Math.min(calls.deleteCodes++, codeResults.length - 1)] as AccountCodeResult),
        onDeleteAccount: (code: string) => {
          calls.deletes.push(code);
          return Promise.resolve({ ok: true as const });
        },
        onAccountDeleted: () => {
          calls.deleted += 1;
        },
      },
      createElement(Text, null, "Account content"),
    ),
  );
  return { calls, screen };
}

const contains = (node: HostNode, target: HostNode): boolean =>
  node === target || node.children.some((child) => typeof child !== "string" && contains(child, target));

describe("SignUpAttestationGate: delete account while gated (Stamp 5.1.1(v), Vera round 4)", () => {
  beforeEach(() => {
    vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
    resetBackListeners();
  });

  it.each(gateScreens)("from %s: confirm first, then the code, then deletion, without accepting", async (_case, read) => {
    const { calls, screen } = await renderGate(read);
    const entry = screen.getPressable(DELETE_ENTRY);
    expect(entry.props.accessibilityHint).toBe("Asks you to confirm before anything is deleted.");
    expect(flattenStyle(screen.queryByText(DELETE_ENTRY)?.props.style).color).toBe(colours.danger);

    await screen.press(DELETE_ENTRY);
    expect(screen.text()).toContain(CONFIRM_TITLE);
    expect(calls.deleteCodes).toBe(0);
    expect(screen.text()).not.toContain("Export my data first");
    expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenLastCalledWith(screen.queryByText(CONFIRM_TITLE), "focus");
    expect(screen.getPressable(EMAIL_CODE).props.accessibilityHint).toBe("Emails you a code to confirm. Nothing is deleted yet.");

    await screen.press(EMAIL_CODE);
    expect(calls.deleteCodes).toBe(1);
    expect(screen.text()).toContain(CODE_TITLE);
    await screen.changeText("6-digit code", "654321");
    await screen.press("Delete my account");

    expect(calls.deletes).toEqual(["654321"]);
    expect(calls.deleted).toBe(1);
    expect(calls.accepts).toBe(0);
    expect(screen.text()).not.toContain("Account content");
  });

  it.each(gateScreens)("from %s: Cancel on the confirm sends no code and returns to the gate", async (_case, read, gateText) => {
    const { calls, screen } = await renderGate(read);
    await screen.press(DELETE_ENTRY);
    await screen.press("Cancel");

    expect(calls.deleteCodes).toBe(0);
    expect(screen.text()).toContain(gateText);
    expect(screen.text()).not.toContain(CONFIRM_TITLE);
    expect(screen.text()).not.toContain("Account content");
    expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenLastCalledWith(screen.getPressable(DELETE_ENTRY), "focus");
  });

  it("Cancel on the code step returns to the gate, still gated", async () => {
    const { screen } = await renderGate(prompt);
    await screen.press(DELETE_ENTRY);
    await screen.press(EMAIL_CODE);
    await screen.press("Cancel");

    expect(screen.text()).toContain(SIGN_UP_ATTESTATION_LABEL);
    expect(screen.text()).not.toContain(CODE_TITLE);
    expect(screen.text()).not.toContain("Account content");
  });

  it("a code send that fails offline shows the grey note, not red; the next tap clears it", async () => {
    const { calls, screen } = await renderGate(prompt, [offline, rateLimited]);
    await screen.press(DELETE_ENTRY);
    await screen.press(EMAIL_CODE);

    expect(flattenStyle(screen.queryByText(SERVER_UNREACHABLE_NOTE)?.props.style).color).toBe(colours.textSecondary);
    expect(screen.text()).not.toContain("We could not send the code.");
    expect(screen.text()).toContain(CONFIRM_TITLE);

    await screen.press(EMAIL_CODE);
    expect(calls.deleteCodes).toBe(2);
    expect(screen.text()).not.toContain(SERVER_UNREACHABLE_NOTE);
  });

  it("a code send that fails for another reason shows the red error and stays on the confirm", async () => {
    const { screen } = await renderGate(readError, [rateLimited]);
    await screen.press(DELETE_ENTRY);
    await screen.press(EMAIL_CODE);

    const error = `We could not send the code. ${FAILURE_MESSAGES.rateLimited}`;
    expect(flattenStyle(screen.queryByText(error)?.props.style).color).toBe(colours.danger);
    expect(screen.text()).not.toContain(SERVER_UNREACHABLE_NOTE);
    expect(screen.text()).toContain(CONFIRM_TITLE);
  });

  // Vera round 4 item 3: the destructive action sits a section gap (24) below Sign out.
  it.each(gateScreens)("on %s, Delete account sits 24 below Sign out", async (_case, read) => {
    const { screen } = await renderGate(read);
    const signOut = screen.getPressable("Sign out");
    const actions = screen.findAllByType("View").find((view) => view.children.includes(signOut));
    const deleteRow = actions?.children.find(
      (child): child is HostNode => typeof child !== "string" && contains(child, screen.getPressable(DELETE_ENTRY)),
    );

    const gap = Number(flattenStyle(actions?.props.style).gap ?? 0);
    const above = Number(flattenStyle(deleteRow?.props.style).marginTop ?? 0);
    expect(gap + above).toBe(24);
  });

  // Vera round 4 item 4: Android back on a delete step acts like its Cancel.
  it("Android back on the confirm and on the code step returns to the gate; on the gate it is not handled", async () => {
    const { calls, screen } = await renderGate(prompt);
    await screen.press(DELETE_ENTRY);
    expect(pressHardwareBack()).toBe(true);
    await screen.rerender();
    expect(calls.deleteCodes).toBe(0);
    expect(screen.text()).toContain(SIGN_UP_ATTESTATION_LABEL);

    await screen.press(DELETE_ENTRY);
    await screen.press(EMAIL_CODE);
    expect(pressHardwareBack()).toBe(true);
    await screen.rerender();
    expect(screen.text()).toContain(SIGN_UP_ATTESTATION_LABEL);
    expect(screen.text()).not.toContain(CODE_TITLE);
    expect(pressHardwareBack()).toBe(false);
  });
});
