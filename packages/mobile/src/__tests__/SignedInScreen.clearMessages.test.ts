import { Platform } from "react-native";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgeConfirmationResult } from "../auth/accountActions";
import { FAILURE_MESSAGES } from "../auth/signInActions";
import { SERVER_UNREACHABLE_NOTE } from "../screens/ServerUnreachableNote";
import type { renderScreen } from "./screenHarness";
import { createSignedInScreenHarness } from "./signedInScreenHarness";

type Screen = Awaited<ReturnType<typeof renderScreen>>;
type Harness = ReturnType<typeof createSignedInScreenHarness>;
interface Stale {
  readonly text: string;
  readonly leave: (harness: Harness, screen: Screen) => Promise<void>;
}

const CONFIRM = "Confirm I am 18 or older";
const DIALOG_YES = "Yes, I am 18 or older";
const SHARED = "Your data export was shared.";
const adultFails = (reason: "network" | "rateLimited"): AgeConfirmationResult => ({ ok: false, reason, message: FAILURE_MESSAGES[reason] });

const exportFails: Stale = {
  text: "Export failed.",
  leave: async (harness, screen) => {
    harness.state.exportResult = Promise.resolve({ ok: false, reason: "rateLimited", message: FAILURE_MESSAGES.rateLimited });
    await screen.press("Export my data");
    harness.state.exportResult = Promise.resolve({ ok: true, json: "{}" });
  },
};
const exportShared: Stale = {
  text: SHARED,
  leave: async (harness, screen) => {
    await screen.press("Export my data");
    harness.state.shareSpy.mockResolvedValue({ action: "dismissedAction" });
  },
};
const adultWith = (text: string, reason: "network" | "rateLimited"): Stale => ({
  text,
  leave: async (harness, screen) => {
    harness.state.adultResult = Promise.resolve(adultFails(reason));
    await screen.press(CONFIRM);
    await screen.press(DIALOG_YES);
  },
});
const staleOnMain: [string, Stale][] = [
  ["a red export error", exportFails],
  ["the grey shared line", exportShared],
  ["a red 18+ error", adultWith("We could not save that.", "rateLimited")],
  ["the grey offline note", adultWith(SERVER_UNREACHABLE_NOTE, "network")],
];
const mainActions: [string, string[]][] = [
  ["Export", ["Export my data"]],
  ["the 18+ tap", [CONFIRM, "Cancel"]],
  ["Delete account", ["Delete account"]],
  ["Sign out", ["Sign out"]],
];

describe("SignedInScreen clears stale messages at the start of each action (HEN-311)", () => {
  let harness: Harness;

  beforeEach(() => {
    Platform.OS = "ios";
    harness = createSignedInScreenHarness();
  });
  afterEach(() => {
    Platform.OS = "android";
  });

  const leaveStale = async (stale: Stale) => {
    const screen = await harness.render();
    await stale.leave(harness, screen);
    expect(screen.text()).toContain(stale.text);
    return screen;
  };

  describe.each(staleOnMain)("with %s on screen", (_name, stale) => {
    it.each(mainActions)("%s clears it", async (_action, titles) => {
      const screen = await leaveStale(stale);
      for (const title of titles) {
        await screen.press(title);
      }
      expect(screen.text()).not.toContain(stale.text);
    });
  });

  it("export fails red, then an offline 18+ save: only the grey note shows", async () => {
    const screen = await leaveStale(exportFails);
    harness.state.adultResult = Promise.resolve(adultFails("network"));
    await screen.press(CONFIRM);
    await screen.press(DIALOG_YES);

    expect(screen.text()).toContain(SERVER_UNREACHABLE_NOTE);
    expect(screen.text()).not.toContain("Export failed.");
  });

  it("on the delete confirm, Email me a code clears the shared line even when the request fails", async () => {
    const screen = await harness.render();
    await screen.press("Delete account");
    await exportShared.leave(harness, screen);
    expect(screen.text()).toContain(SHARED);
    harness.state.codeResult = Promise.resolve({ ok: false, reason: "rateLimited", message: FAILURE_MESSAGES.rateLimited });
    await screen.press("Email me a code");

    expect(screen.text()).toContain("We could not send the code.");
    expect(screen.text()).not.toContain(SHARED);
  });

  it("on the delete confirm, Export clears a red code error", async () => {
    const screen = await harness.render();
    await screen.press("Delete account");
    harness.state.codeResult = Promise.resolve({ ok: false, reason: "rateLimited", message: FAILURE_MESSAGES.rateLimited });
    await screen.press("Email me a code");
    expect(screen.text()).toContain("We could not send the code.");
    await screen.press("Export my data first");

    expect(screen.text()).not.toContain("We could not send the code.");
  });

  it("Cancel clears the shared line", async () => {
    const screen = await harness.render();
    await screen.press("Delete account");
    await exportShared.leave(harness, screen);
    await screen.press("Cancel");

    expect(screen.text()).not.toContain(SHARED);
  });
});
