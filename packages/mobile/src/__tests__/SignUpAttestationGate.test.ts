import { SIGN_UP_ATTESTATION_DUTIES, SIGN_UP_ATTESTATION_LABEL, SIGN_UP_ATTESTATION_TEXT_VERSION } from "@bjj-roll/shared";
import { createElement } from "react";
import { Text } from "react-native";
import { describe, expect, it } from "vitest";
import type { SignUpAttestationResult } from "../auth/accountActions";
import { FAILURE_MESSAGES } from "../auth/signInActions";
import { ATTESTATION_NEEDED_HINT, ATTESTATION_SAVING } from "../auth/signUpAttestation";
import { GATE_READ_ERROR, SignUpAttestationGate, TRY_AGAIN } from "../screens/SignUpAttestationGate";
import { SERVER_UNREACHABLE_NOTE } from "../screens/ServerUnreachableNote";
import { colours } from "../theme/tokens";
import { flattenStyle, renderScreen } from "./screenHarness";

const CURRENT = SIGN_UP_ATTESTATION_TEXT_VERSION.id;
const ACCEPT = "Accept and continue";
const required = (acceptedTextVersionId: string | null): SignUpAttestationResult => ({
  ok: true,
  status: { required: true, currentTextVersionId: CURRENT, acceptedTextVersionId },
});
const accepted: SignUpAttestationResult = { ok: true, status: { required: false, currentTextVersionId: CURRENT, acceptedTextVersionId: CURRENT } };

function renderGate(reads: SignUpAttestationResult[], accepts: SignUpAttestationResult[]) {
  const calls = { reads: 0, accepts: 0, signOuts: 0, deleteCodes: 0, deletes: [] as string[], deleted: 0 };
  const element = createElement(
    SignUpAttestationGate,
    {
      onReadStatus: () => Promise.resolve(reads[Math.min(calls.reads++, reads.length - 1)] as SignUpAttestationResult),
      onAccept: () => Promise.resolve(accepts[Math.min(calls.accepts++, accepts.length - 1)] as SignUpAttestationResult),
      onSignOut: () => {
        calls.signOuts += 1;
      },
      onRequestDeleteCode: () => {
        calls.deleteCodes += 1;
        return Promise.resolve({ ok: true as const });
      },
      onDeleteAccount: (code: string) => {
        calls.deletes.push(code);
        return Promise.resolve({ ok: true as const });
      },
      onAccountDeleted: () => {
        calls.deleted += 1;
      },
    },
    createElement(Text, null, "Account content"),
  );
  return { calls, render: async () => await renderScreen(element) };
}

describe("SignUpAttestationGate (HEN-183 re-prompt)", () => {
  it("an account that accepted the current version goes straight to the app", async () => {
    const gate = renderGate([accepted], []);
    const screen = await gate.render();

    expect(screen.text()).toContain("Account content");
    expect(screen.text()).not.toContain(SIGN_UP_ATTESTATION_LABEL);
  });

  it.each([
    ["an account with no record", null],
    ["an account that accepted an older text version", "attestation-signup-draft-0"],
  ])("%s stays on the prompt until it accepts the current version", async (_case, acceptedVersion) => {
    const gate = renderGate([required(acceptedVersion)], [accepted]);
    const screen = await gate.render();

    expect(screen.text()).not.toContain("Account content");
    for (const duty of SIGN_UP_ATTESTATION_DUTIES) {
      expect(screen.text()).toContain(duty);
    }
    expect(screen.text()).toContain(CURRENT);
    await screen.press(ACCEPT);
    expect(gate.calls.accepts).toBe(0);
    expect(screen.text()).not.toContain("Account content");
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    await screen.press(ACCEPT);
    expect(gate.calls.accepts).toBe(1);
    expect(screen.text()).toContain("Account content");
  });

  const offline: SignUpAttestationResult = { ok: false, reason: "network", message: FAILURE_MESSAGES.network };
  const serverError: SignUpAttestationResult = { ok: false, reason: "unknown", message: FAILURE_MESSAGES.unknown };
  const expectNoDuties = (screen: Awaited<ReturnType<ReturnType<typeof renderGate>["render"]>>) => {
    expect(screen.text()).not.toContain("Account content");
    expect(screen.text()).not.toContain(SIGN_UP_ATTESTATION_LABEL);
    for (const duty of SIGN_UP_ATTESTATION_DUTIES) {
      expect(screen.text()).not.toContain(duty);
    }
  };

  it("a status read that fails offline shows the grey note and Try again, not the duties; a retry that succeeds reaches the app", async () => {
    const gate = renderGate([offline, accepted], []);
    const screen = await gate.render();

    expectNoDuties(screen);
    expect(flattenStyle(screen.queryByText(SERVER_UNREACHABLE_NOTE)?.props.style).color).toBe(colours.textSecondary);
    expect(screen.text()).not.toContain(GATE_READ_ERROR);
    expect(screen.getPressable("Sign out")).toBeTruthy();
    await screen.press(TRY_AGAIN);
    expect(gate.calls.reads).toBe(2);
    expect(screen.text()).toContain("Account content");
  });

  it("a status read that fails on the server shows the red error and Try again; a retry that says required shows the prompt", async () => {
    const gate = renderGate([serverError, required(null)], []);
    const screen = await gate.render();

    expectNoDuties(screen);
    expect(flattenStyle(screen.queryByText(GATE_READ_ERROR)?.props.style).color).toBe(colours.danger);
    expect(screen.text()).not.toContain(SERVER_UNREACHABLE_NOTE);
    await screen.press(TRY_AGAIN);
    expect(screen.text()).toContain(SIGN_UP_ATTESTATION_LABEL);
    expect(screen.text()).not.toContain(GATE_READ_ERROR);
  });

  it("Sign out works from the read error state", async () => {
    const gate = renderGate([offline], []);
    const screen = await gate.render();
    await screen.press("Sign out");
    expect(gate.calls.signOuts).toBe(1);
  });

  it("an Accept that fails offline shows the grey note, not a red error, and the next tap clears it", async () => {
    const gate = renderGate([required(null)], [offline, accepted]);
    const screen = await gate.render();
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    await screen.press(ACCEPT);

    expect(flattenStyle(screen.queryByText(SERVER_UNREACHABLE_NOTE)?.props.style).color).toBe(colours.textSecondary);
    expect(screen.text()).not.toContain(FAILURE_MESSAGES.network);
    expect(screen.text()).not.toContain("Account content");
    await screen.press(ACCEPT);
    expect(screen.text()).toContain("Account content");
  });

  it("Accept and continue has the tick hint only while the box is unticked", async () => {
    const screen = await renderGate([required(null)], []).render();
    expect(screen.getPressable(ACCEPT).props.accessibilityHint).toBe(ATTESTATION_NEEDED_HINT);
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    expect(screen.getPressable(ACCEPT).props.accessibilityHint).toBeUndefined();
  });

  it("Accept shows Saving… while the accept is in flight", async () => {
    const element = createElement(SignUpAttestationGate, {
      onReadStatus: () => Promise.resolve(required(null)),
      onAccept: () => new Promise<SignUpAttestationResult>(() => undefined),
      onSignOut: () => undefined,
      onRequestDeleteCode: () => Promise.resolve({ ok: true as const }),
      onDeleteAccount: () => Promise.resolve({ ok: true as const }),
      onAccountDeleted: () => undefined,
    });
    const screen = await renderScreen(element);
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    await screen.press(ACCEPT);
    expect(screen.text()).toContain(ATTESTATION_SAVING);
  });

  it("a 200 that still says required keeps the prompt", async () => {
    const gate = renderGate([required(null)], [required(null)]);
    const screen = await gate.render();
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    await screen.press(ACCEPT);

    expect(screen.text()).not.toContain("Account content");
    expect(screen.text()).toContain(FAILURE_MESSAGES.unknown);
  });

  it("offers Sign out from the prompt", async () => {
    const gate = renderGate([required(null)], []);
    const screen = await gate.render();
    await screen.press("Sign out");

    expect(gate.calls.signOuts).toBe(1);
  });
});
