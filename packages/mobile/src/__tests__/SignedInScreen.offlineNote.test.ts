// HEN-305 (Vera): when the server can't be reached, the five account actions show only the grey offline note, never a red
// "No connection" message. Other failures keep their red messages. One message at a time; the next action clears the note.
import { SIGN_UP_ATTESTATION_TEXT_VERSION } from "@bjj-roll/shared";
import { createElement } from "react";
import { Text } from "react-native";
import { beforeEach, describe, expect, it } from "vitest";
import type { AccountCodeResult, AccountDeletionResult, AccountExportResult } from "../auth/accountActions";
import { FAILURE_MESSAGES } from "../auth/signInActions";
import { SERVER_UNREACHABLE_NOTE } from "../screens/ServerUnreachableNote";
import { SignUpAttestationGate } from "../screens/SignUpAttestationGate";
import { colours } from "../theme/tokens";
import { flattenStyle, renderScreen } from "./screenHarness";
import { createSignedInScreenHarness, deferred, EXPORT_JSON } from "./signedInScreenHarness";

const offline = { ok: false, reason: "network", message: FAILURE_MESSAGES.network } as const;
const unknown = { ok: false, reason: "unknown", message: FAILURE_MESSAGES.unknown } as const;
const rateLimited = { ok: false, reason: "rateLimited", message: FAILURE_MESSAGES.rateLimited } as const;

type Screen = Awaited<ReturnType<typeof renderScreen>>;

/** The note alone: grey, polite (no alert role), and no red message or "No connection" anywhere. */
function expectNoteAlone(screen: Screen) {
  const note = screen.queryByText(SERVER_UNREACHABLE_NOTE);
  expect(note).not.toBeNull();
  expect(flattenStyle(note?.props.style).color).toBe(colours.textSecondary);
  expect(note?.props.accessibilityRole).toBeUndefined();
  expect(screen.text()).not.toContain(FAILURE_MESSAGES.network);
  for (const node of screen.findAllByType("Text")) {
    expect(node.props.accessibilityRole).not.toBe("alert");
  }
}

function expectRedAlone(screen: Screen, message: string) {
  const error = screen.queryByText(message);
  expect(error?.props.accessibilityRole).toBe("alert");
  expect(flattenStyle(error?.props.style).color).toBe(colours.danger);
  expect(screen.text()).not.toContain(SERVER_UNREACHABLE_NOTE);
}

describe("SignedInScreen: the grey offline note on the account actions (HEN-305)", () => {
  let harness: ReturnType<typeof createSignedInScreenHarness>;
  let state: ReturnType<typeof createSignedInScreenHarness>["state"];

  beforeEach(() => {
    harness = createSignedInScreenHarness();
    state = harness.state;
  });

  it("place 1, Export my data: offline shows only the note, under the button; the next export clears it at once", async () => {
    state.exportResult = Promise.resolve<AccountExportResult>(offline);
    const screen = await harness.render();
    await screen.press("Export my data");

    expectNoteAlone(screen);
    expect(screen.text()).not.toContain("Export failed.");
    const text = screen.text();
    expect(text.indexOf(SERVER_UNREACHABLE_NOTE)).toBeGreaterThan(text.indexOf("Export my data"));
    expect(text.indexOf(SERVER_UNREACHABLE_NOTE)).toBeLessThan(text.indexOf("Delete account"));

    const pending = deferred<AccountExportResult>();
    state.exportResult = pending.promise;
    (screen.getPressable("Export my data").props.onPress as () => void)();
    await screen.rerender();
    expect(screen.text()).not.toContain(SERVER_UNREACHABLE_NOTE);
    pending.resolve({ ok: true, json: EXPORT_JSON });
    await screen.rerender();
    expect(state.shareSpy).toHaveBeenCalledTimes(1);
  });

  it("place 1: unknown, rate-limited and share sheet failures stay red, and red and the note replace each other", async () => {
    state.exportResult = Promise.resolve<AccountExportResult>(unknown);
    const screen = await harness.render();
    await screen.press("Export my data");
    expectRedAlone(screen, `Export failed. ${FAILURE_MESSAGES.unknown}`);

    state.exportResult = Promise.resolve<AccountExportResult>(offline);
    await screen.press("Export my data");
    expectNoteAlone(screen);

    state.exportResult = Promise.resolve<AccountExportResult>(rateLimited);
    await screen.press("Export my data");
    expectRedAlone(screen, `Export failed. ${FAILURE_MESSAGES.rateLimited}`);

    state.exportResult = Promise.resolve<AccountExportResult>({ ok: true, json: EXPORT_JSON });
    state.shareSpy.mockRejectedValueOnce(new Error("share sheet failed"));
    await screen.press("Export my data");
    expectRedAlone(screen, `Export failed. ${FAILURE_MESSAGES.unknown}`);
  });

  it("on the main screen, Delete account, the 18+ confirm and Sign out each clear the note", async () => {
    state.exportResult = Promise.resolve<AccountExportResult>(offline);
    const screen = await harness.render();

    await screen.press("Export my data");
    await screen.press("Delete account");
    expect(screen.text()).toContain("Delete your account?");
    expect(screen.text()).not.toContain(SERVER_UNREACHABLE_NOTE);
    await screen.press("Cancel");

    await screen.press("Export my data");
    expect(screen.text()).toContain(SERVER_UNREACHABLE_NOTE);
    await screen.press("Confirm I am 18 or older");
    await screen.press("Cancel");
    expect(screen.text()).not.toContain(SERVER_UNREACHABLE_NOTE);

    await screen.press("Export my data");
    expect(screen.text()).toContain(SERVER_UNREACHABLE_NOTE);
    await screen.press("Sign out");
    expect(state.signOutCalls).toBe(1);
    expect(screen.text()).not.toContain(SERVER_UNREACHABLE_NOTE);
  });

  it("place 2, Export my data first: offline shows only the note on the confirm; Cancel clears it", async () => {
    const screen = await harness.render();
    await screen.press("Delete account");
    state.exportResult = Promise.resolve<AccountExportResult>(offline);
    await screen.press("Export my data first");

    expectNoteAlone(screen);
    expect(screen.text()).toContain("Delete your account?");
    const text = screen.text();
    expect(text.indexOf(SERVER_UNREACHABLE_NOTE)).toBeLessThan(text.indexOf("Export my data first"));

    state.exportResult = Promise.resolve<AccountExportResult>(unknown);
    await screen.press("Export my data first");
    expectRedAlone(screen, `Export failed. ${FAILURE_MESSAGES.unknown}`);

    state.exportResult = Promise.resolve<AccountExportResult>(offline);
    await screen.press("Export my data first");
    await screen.press("Cancel");
    await screen.press("Delete account");
    expect(screen.text()).not.toContain(SERVER_UNREACHABLE_NOTE);
  });

  it("place 3, Email me a code: offline shows only the note and stays on the confirm; other failures stay red", async () => {
    state.codeResult = Promise.resolve<AccountCodeResult>(offline);
    const screen = await harness.render();
    await screen.press("Delete account");
    await screen.press("Email me a code");

    expectNoteAlone(screen);
    expect(screen.text()).not.toContain("We could not send the code.");
    expect(screen.text()).toContain("Delete your account?");

    state.codeResult = Promise.resolve<AccountCodeResult>(rateLimited);
    await screen.press("Email me a code");
    expectRedAlone(screen, `We could not send the code. ${FAILURE_MESSAGES.rateLimited}`);

    state.codeResult = Promise.resolve<AccountCodeResult>(offline);
    await screen.press("Email me a code");
    expectNoteAlone(screen);
    state.exportResult = Promise.resolve<AccountExportResult>({ ok: true, json: EXPORT_JSON });
    await screen.press("Export my data first");
    expect(screen.text()).not.toContain(SERVER_UNREACHABLE_NOTE);
  });

  it("place 4, Delete my account: offline shows only the note between the field and the actions; typing keeps it", async () => {
    state.deleteResult = Promise.resolve<AccountDeletionResult>(offline);
    const screen = await harness.renderAtCodeStep();
    await screen.changeText("6-digit code", "654321");
    await screen.press("Delete my account");

    expectNoteAlone(screen);
    expect(screen.text()).not.toContain("Your account was not deleted.");
    expect(state.deletedCalls).toBe(0);
    const text = screen.text();
    expect(text.indexOf(SERVER_UNREACHABLE_NOTE)).toBeGreaterThan(text.indexOf("with no undo."));
    expect(text.indexOf(SERVER_UNREACHABLE_NOTE)).toBeLessThan(text.indexOf("Delete my account"));

    await screen.changeText("6-digit code", "654320");
    expect(screen.text()).toContain(SERVER_UNREACHABLE_NOTE);

    state.deleteResult = Promise.resolve<AccountDeletionResult>(unknown);
    await screen.press("Delete my account");
    expectRedAlone(screen, `Your account was not deleted. ${FAILURE_MESSAGES.unknown}`);

    state.deleteResult = Promise.resolve<AccountDeletionResult>({ ok: false, reason: "invalidCode", message: FAILURE_MESSAGES.invalidCode });
    await screen.press("Delete my account");
    expect(screen.text()).toContain(FAILURE_MESSAGES.invalidCode);
    expect(screen.text()).not.toContain(SERVER_UNREACHABLE_NOTE);
  });

  it("place 5, Send a new code: offline shows only the note; other failures stay red; success shows the muted notice", async () => {
    const screen = await harness.renderAtCodeStep();
    state.codeResult = Promise.resolve<AccountCodeResult>(offline);
    await screen.press("Send a new code");
    expectNoteAlone(screen);
    expect(screen.text()).not.toContain("We could not send the code.");

    state.codeResult = Promise.resolve<AccountCodeResult>(rateLimited);
    await screen.press("Send a new code");
    expectRedAlone(screen, `We could not send the code. ${FAILURE_MESSAGES.rateLimited}`);

    state.codeResult = Promise.resolve<AccountCodeResult>(offline);
    await screen.press("Send a new code");
    state.codeResult = Promise.resolve<AccountCodeResult>({ ok: true });
    await screen.press("Send a new code");
    expect(screen.text()).toContain("We sent a new code to your email.");
    expect(screen.text()).not.toContain(SERVER_UNREACHABLE_NOTE);
  });
});

describe("SignUpAttestationGate code step: the same grey offline note (HEN-305, places 4 and 5)", () => {
  async function renderGateAtCodeStep(codeResults: AccountCodeResult[], deleteResult: AccountDeletionResult) {
    let sends = 0;
    const screen = await renderScreen(
      createElement(
        SignUpAttestationGate,
        {
          onReadStatus: () =>
            Promise.resolve({
              ok: true,
              status: { required: true, currentTextVersionId: SIGN_UP_ATTESTATION_TEXT_VERSION.id, acceptedTextVersionId: null },
            } as const),
          onAccept: () => Promise.reject(new Error("not used")),
          onSignOut: () => undefined,
          onRequestDeleteCode: () => Promise.resolve(codeResults[Math.min(sends++, codeResults.length - 1)] as AccountCodeResult),
          onDeleteAccount: () => Promise.resolve(deleteResult),
          onAccountDeleted: () => undefined,
        },
        createElement(Text, null, "Account content"),
      ),
    );
    await screen.press("Delete account");
    await screen.press("Email me a code");
    expect(screen.text()).toContain("Enter the code we emailed you");
    return screen;
  }

  it("Delete my account offline shows only the note", async () => {
    const screen = await renderGateAtCodeStep([{ ok: true }], offline);
    await screen.changeText("6-digit code", "654321");
    await screen.press("Delete my account");
    expectNoteAlone(screen);
    expect(screen.text()).not.toContain("Your account was not deleted.");
  });

  it("Send a new code offline shows only the note; a rate limit stays red", async () => {
    const screen = await renderGateAtCodeStep([{ ok: true }, offline, rateLimited], { ok: true });
    await screen.press("Send a new code");
    expectNoteAlone(screen);
    await screen.press("Send a new code");
    expectRedAlone(screen, `We could not send the code. ${FAILURE_MESSAGES.rateLimited}`);
  });
});
