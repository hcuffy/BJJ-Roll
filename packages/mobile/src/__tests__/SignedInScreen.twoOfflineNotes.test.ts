// HEN-311 after #93: two grey offline notes, each in its own slot, and one clearMessages() clears both.
import { beforeEach, describe, expect, it } from "vitest";
import type { AgeConfirmationResult } from "../auth/accountActions";
import { FAILURE_MESSAGES } from "../auth/signInActions";
import { SERVER_UNREACHABLE_NOTE } from "../screens/ServerUnreachableNote";
import type { renderScreen } from "./screenHarness";
import { createSignedInScreenHarness } from "./signedInScreenHarness";

type Screen = Awaited<ReturnType<typeof renderScreen>>;

const EXPORT = "Export my data";
const CONFIRM = "Confirm I am 18 or older";
const DIALOG_YES = "Yes, I am 18 or older";
const TOGGLE = "Biometric unlock";
const offline = { ok: false, reason: "network", message: FAILURE_MESSAGES.network } as const;

const noteCount = (screen: Screen) => screen.text().split(SERVER_UNREACHABLE_NOTE).length - 1;

/** The note shows once, after `before` and ahead of `after` in reading order. */
function expectOneNoteBetween(screen: Screen, before: string, after: string) {
  const text = screen.text();
  expect(noteCount(screen)).toBe(1);
  expect(text.indexOf(before)).toBeLessThan(text.indexOf(SERVER_UNREACHABLE_NOTE));
  expect(text.indexOf(SERVER_UNREACHABLE_NOTE)).toBeLessThan(text.indexOf(after));
}

describe("SignedInScreen: the export note and the 18+ note (HEN-305, HEN-311)", () => {
  let harness: ReturnType<typeof createSignedInScreenHarness>;

  beforeEach(() => {
    harness = createSignedInScreenHarness();
  });

  const exportOffline = async (screen: Screen) => {
    harness.state.exportResult = Promise.resolve(offline);
    await screen.press(EXPORT);
  };
  const confirmAdultOffline = async (screen: Screen) => {
    harness.state.adultResult = Promise.resolve<AgeConfirmationResult>(offline);
    await screen.press(CONFIRM);
    await screen.press(DIALOG_YES);
  };

  it("an offline export shows the note under Export my data, above the 18+ row", async () => {
    const screen = await harness.render();
    await exportOffline(screen);
    expectOneNoteBetween(screen, EXPORT, CONFIRM);
  });

  it("an offline 18+ confirm shows the note under the 18+ row, above Biometric unlock", async () => {
    const screen = await harness.render();
    await confirmAdultOffline(screen);
    expectOneNoteBetween(screen, CONFIRM, TOGGLE);
  });

  it("the 18+ tap clears the export note, so only the 18+ note shows", async () => {
    const screen = await harness.render();
    await exportOffline(screen);
    await confirmAdultOffline(screen);
    expectOneNoteBetween(screen, CONFIRM, TOGGLE);
  });

  it("an export clears the 18+ note, so only the export note shows", async () => {
    const screen = await harness.render();
    await confirmAdultOffline(screen);
    await exportOffline(screen);
    expectOneNoteBetween(screen, EXPORT, CONFIRM);
  });

  it("one signed-in action clears both notes: a working export leaves none", async () => {
    const screen = await harness.render();
    await confirmAdultOffline(screen);
    await exportOffline(screen);
    harness.state.exportResult = Promise.resolve({ ok: true, json: "{}" });
    await screen.press(EXPORT);
    expect(noteCount(screen)).toBe(0);
  });
});
