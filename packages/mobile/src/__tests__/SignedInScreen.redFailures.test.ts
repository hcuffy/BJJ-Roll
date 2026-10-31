import { describe, expect, it } from "vitest";
import type { AccountCodeResult, AccountDeletionResult, AccountExportResult } from "../auth/accountActions";
import { failureMessages } from "../auth/signInActions";
import { SERVER_UNREACHABLE_NOTE } from "../screens/ServerUnreachableNote";
import { colours } from "../theme/tokens";
import { flattenStyle, type renderScreen } from "./screenHarness";
import { createSignedInScreenHarness } from "./signedInScreenHarness";

const unknown = { ok: false, reason: "unknown", message: failureMessages.unknown } as const;
const rateLimited = { ok: false, reason: "rateLimited", message: failureMessages.rateLimited } as const;

type Screen = Awaited<ReturnType<typeof renderScreen>>;

function expectRedAlone(screen: Screen, message: string) {
  const error = screen.queryByText(message);
  expect(error?.props.accessibilityRole).toBe("alert");
  expect(flattenStyle(error?.props.style).color).toBe(colours.danger);
  expect(screen.text()).not.toContain(SERVER_UNREACHABLE_NOTE);
}

describe("each account action keeps its red message for a server error and a rate limit (HEN-305)", () => {
  type Harness = ReturnType<typeof createSignedInScreenHarness>;
  type Failure = typeof unknown | typeof rateLimited;
  const surfaces: readonly (readonly [string, string, (harness: Harness, failure: Failure) => Promise<Screen>])[] = [
    [
      "Export my data",
      "Export failed.",
      async (harness, failure) => {
        harness.state.exportResult = Promise.resolve<AccountExportResult>(failure);
        const screen = await harness.render();
        await screen.press("Export my data");
        return screen;
      },
    ],
    [
      "Export my data first",
      "Export failed.",
      async (harness, failure) => {
        const screen = await harness.render();
        await screen.press("Delete account");
        harness.state.exportResult = Promise.resolve<AccountExportResult>(failure);
        await screen.press("Export my data first");
        return screen;
      },
    ],
    [
      "Email me a code",
      "We could not send the code.",
      async (harness, failure) => {
        harness.state.codeResult = Promise.resolve<AccountCodeResult>(failure);
        const screen = await harness.render();
        await screen.press("Delete account");
        await screen.press("Email me a code");
        return screen;
      },
    ],
    [
      "Delete my account",
      "Your account was not deleted.",
      async (harness, failure) => {
        harness.state.deleteResult = Promise.resolve<AccountDeletionResult>(failure);
        const screen = await harness.renderAtCodeStep();
        await screen.changeText("6-digit code", "654321");
        await screen.press("Delete my account");
        return screen;
      },
    ],
    [
      "Send a new code",
      "We could not send the code.",
      async (harness, failure) => {
        const screen = await harness.renderAtCodeStep();
        harness.state.codeResult = Promise.resolve<AccountCodeResult>(failure);
        await screen.press("Send a new code");
        return screen;
      },
    ],
  ];

  for (const [surface, leadIn, fail] of surfaces) {
    for (const failure of [unknown, rateLimited]) {
      it(`${surface}: ${failure.reason} shows "${leadIn} ${failure.message}" in red, with no note`, async () => {
        const screen = await fail(createSignedInScreenHarness(), failure);
        expectRedAlone(screen, `${leadIn} ${failure.message}`);
      });
    }
  }
});
