import { SIGN_UP_ATTESTATION_TEXT_VERSION } from "@bjj-roll/shared";
import { createElement } from "react";
import { Text } from "react-native";
import { describe, expect, it } from "vitest";
import type { AccountCodeResult, AccountDeletionResult, AccountExportResult, SignUpAttestationResult } from "../auth/accountActions";
import { FAILURE_MESSAGES } from "../auth/signInActions";
import { SERVER_UNREACHABLE_NOTE } from "../screens/ServerUnreachableNote";
import { SignUpAttestationGate } from "../screens/SignUpAttestationGate";
import { renderScreen } from "./screenHarness";
import { EXPORT_JSON } from "./signedInScreenHarness";

const CODE_ERROR = `We could not send the code. ${FAILURE_MESSAGES.rateLimited}`;

describe("SignUpAttestationGate: a second Email me a code clears the first one's message", () => {
  it("a rate-limited code send, then an offline one, shows only the grey note", async () => {
    const codeResults: AccountCodeResult[] = [
      { ok: false, reason: "rateLimited", message: FAILURE_MESSAGES.rateLimited },
      { ok: false, reason: "network", message: FAILURE_MESSAGES.network },
    ];
    let sends = 0;
    const screen = await renderScreen(
      createElement(
        SignUpAttestationGate,
        {
          onReadStatus: () =>
            Promise.resolve<SignUpAttestationResult>({
              ok: true,
              status: { required: true, currentTextVersionId: SIGN_UP_ATTESTATION_TEXT_VERSION.id, acceptedTextVersionId: null },
            }),
          onAccept: () => Promise.reject(new Error("not used")),
          onSignOut: () => undefined,
          onExportData: () => Promise.resolve<AccountExportResult>({ ok: true, json: EXPORT_JSON }),
          onRequestDeleteCode: () => Promise.resolve<AccountCodeResult>(codeResults[sends++] ?? { ok: true }),
          onDeleteAccount: () => Promise.resolve<AccountDeletionResult>({ ok: true }),
          onAccountDeleted: () => undefined,
        },
        createElement(Text, null, "Account content"),
      ),
    );
    await screen.press("Delete account");

    await screen.press("Email me a code");
    expect(screen.text()).toContain(CODE_ERROR);

    await screen.press("Email me a code");
    expect(sends).toBe(2);
    expect(screen.text()).toContain(SERVER_UNREACHABLE_NOTE);
    expect(screen.text()).not.toContain(CODE_ERROR);
  });
});
