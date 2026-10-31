import { beforeEach, describe, expect, it } from "vitest";
import type { AgeConfirmationResult } from "../auth/accountActions";
import { FAILURE_MESSAGES } from "../auth/signInActions";
import { SERVER_UNREACHABLE_NOTE } from "../screens/ServerUnreachableNote";
import { colours } from "../theme/tokens";
import { flattenStyle } from "./screenHarness";
import { createSignedInScreenHarness } from "./signedInScreenHarness";

const CONFIRM = "Confirm I am 18 or older";
const CANT_UNDO = "You can't undo this, except by deleting your account.";
const DIALOG_YES = "Yes, I am 18 or older";
const NOT_SAVED = "We could not save that.";
const failed = (reason: "network" | "rateLimited" | "unknown"): AgeConfirmationResult => ({ ok: false, reason, message: FAILURE_MESSAGES[reason] });

describe("SignedInScreen 18+ confirm offline note (HEN-311)", () => {
  let harness: ReturnType<typeof createSignedInScreenHarness>;

  beforeEach(() => {
    harness = createSignedInScreenHarness();
  });

  const confirmOffline = async () => {
    harness.state.adultResult = Promise.resolve(failed("network"));
    const screen = await harness.render();
    await screen.press(CONFIRM);
    await screen.press(DIALOG_YES);
    expect(screen.text()).toContain(SERVER_UNREACHABLE_NOTE);
    return screen;
  };

  it("a network failure shows only the grey note, under the 18+ item, not red 'We could not save that'", async () => {
    const screen = await confirmOffline();

    const note = screen.queryByText(SERVER_UNREACHABLE_NOTE);
    expect(note?.props).toMatchObject({ accessibilityLiveRegion: "polite" });
    expect(note?.props.accessibilityRole).toBeUndefined();
    expect(flattenStyle(note?.props.style).color).toBe(colours.textSecondary);
    expect(screen.text()).not.toContain(NOT_SAVED);
    expect(screen.findAllByType("Text").filter((text) => text.props.accessibilityRole === "alert")).toEqual([]);
    const text = screen.text();
    expect(text.indexOf(SERVER_UNREACHABLE_NOTE)).toBeGreaterThan(text.indexOf(CANT_UNDO));
    expect(text.indexOf(SERVER_UNREACHABLE_NOTE)).toBeLessThan(text.indexOf("Delete account"));
    expect(screen.getPressable(CONFIRM)).toBeDefined();
  });

  it.each([
    ["500", "unknown"],
    ["429", "rateLimited"],
  ] as const)("a %s stays red with its lead-in, and no grey note", async (_status, reason) => {
    harness.state.adultResult = Promise.resolve(failed(reason));
    const screen = await harness.render();
    await screen.press(CONFIRM);
    await screen.press(DIALOG_YES);

    const error = screen.queryByText(`${NOT_SAVED} ${FAILURE_MESSAGES[reason]}`);
    expect(error?.props.accessibilityRole).toBe("alert");
    expect(flattenStyle(error?.props.style).color).toBe(colours.danger);
    expect(screen.text()).not.toContain(SERVER_UNREACHABLE_NOTE);
  });

  it("the note clears on the next 18+ tap", async () => {
    const screen = await confirmOffline();
    await screen.press(CONFIRM);
    await screen.press("Cancel");
    expect(screen.text()).not.toContain(SERVER_UNREACHABLE_NOTE);
  });

  it("the note clears on an export", async () => {
    const screen = await confirmOffline();
    await screen.press("Export my data");
    expect(harness.state.exportCalls).toBe(1);
    expect(screen.text()).not.toContain(SERVER_UNREACHABLE_NOTE);
  });

  it("the note clears on Delete account", async () => {
    const screen = await confirmOffline();
    await screen.press("Delete account");
    await screen.press("Cancel");
    expect(screen.text()).toContain(CONFIRM);
    expect(screen.text()).not.toContain(SERVER_UNREACHABLE_NOTE);
  });

  it("the note clears on Sign out", async () => {
    const screen = await confirmOffline();
    await screen.press("Sign out");
    expect(harness.state.signOutCalls).toBe(1);
    expect(screen.text()).not.toContain(SERVER_UNREACHABLE_NOTE);
  });
});
