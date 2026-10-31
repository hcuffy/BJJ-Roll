import { SIGN_UP_ATTESTATION_LABEL } from "@bjj-roll/shared";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { createMobileAuthClient } from "../auth/authClient";
import { SOCIAL_SIGN_IN_CALLBACK_URL } from "../auth/socialSignIn";
import { EmailEntryScreen, SERVER_UNREACHABLE_NOTE } from "../screens/EmailEntryScreen";
import { colours } from "../theme/tokens";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL } from "./authTestDoubles";
import { flattenStyle, renderScreen, settle, textOf } from "./screenHarness";

interface BrowserResult {
  type: string;
  url?: string;
}
const SIGNED_IN_URL = `${SOCIAL_SIGN_IN_CALLBACK_URL}?code=one-time-code`;

function setUp(options: { serverUnreachable?: boolean } = {}) {
  const backend = createFakeBackend();
  const control = { offline: false, holdExchange: null as Promise<void> | null };
  const client = createMobileAuthClient({
    backendUrl: TEST_BACKEND_URL,
    storage: createMemorySecureStore(),
    fetchImplementation: async (input: string | URL | Request, init?: RequestInit) => {
      if (control.offline) {
        throw new TypeError("Network request failed");
      }
      if (String(input instanceof Request ? input.url : input).endsWith("/magic-link/exchange") && control.holdExchange) {
        await control.holdExchange;
      }
      return await backend.fetchImplementation(input, init);
    },
  });
  const browser = { openAuthSessionAsync: vi.fn<() => Promise<BrowserResult>>(() => Promise.resolve({ type: "success", url: SIGNED_IN_URL })) };
  const onClearServerUnreachable = vi.fn();
  const element = createElement(EmailEntryScreen, {
    client,
    onCodeSent: () => undefined,
    socialProviders: ["google"],
    socialSignIn: { client, backendUrl: TEST_BACKEND_URL, platform: "android", browser },
    serverUnreachable: options.serverUnreachable ?? false,
    onClearServerUnreachable,
  });
  return { control, browser, onClearServerUnreachable, render: () => renderScreen(element) };
}

describe("HEN-239 social sign-in status on the sign-in screen (Vera interim items 4-7)", () => {
  it("names the email path: the lime button is 'Continue with email' (item 7)", async () => {
    const screen = await setUp().render();

    expect(screen.queryByText("Continue with email")).not.toBeNull();
    expect(screen.findAllByType("Text").map(textOf)).not.toContain("Continue");
  });

  it("a social attempt clears App's server-unreachable flag (item 4)", async () => {
    const { render, onClearServerUnreachable } = setUp({ serverUnreachable: true });
    const screen = await render();

    await screen.press("I am 16 or older");
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    await screen.press("Sign in with Google");

    expect(onClearServerUnreachable).toHaveBeenCalled();
  });

  it("a social attempt clears the screen's own offline note from an earlier failed send (item 4)", async () => {
    const { render, control } = setUp();
    const screen = await render();
    await screen.press("I am 16 or older");
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    await screen.changeText("Email", "member@example.test");
    control.offline = true;
    await screen.press("Continue with email");
    expect(screen.text()).toContain(SERVER_UNREACHABLE_NOTE);

    control.offline = false;
    await screen.press("Sign in with Google");

    expect(screen.text()).not.toContain(SERVER_UNREACHABLE_NOTE);
  });

  it("shows 'Opening Google…' with a spinner under the buttons, then 'Signing in…' after the browser returns (item 5)", async () => {
    const { render, control, browser } = setUp();
    let returnFromBrowser: (result: BrowserResult) => void = () => undefined;
    browser.openAuthSessionAsync.mockImplementationOnce(() => new Promise((resolve) => (returnFromBrowser = resolve)));
    let finishExchange: () => void = () => undefined;
    control.holdExchange = new Promise((resolve) => (finishExchange = resolve));
    const screen = await render();
    await screen.press("I am 16 or older");
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    await screen.press("Sign in with Google");

    const texts = () => screen.findAllByType("Text").map(textOf);
    expect(texts()).toContain("Opening Google…");
    expect(texts().indexOf("Opening Google…")).toBeGreaterThan(texts().indexOf("or"));
    expect(screen.findAllByType("ActivityIndicator")).toHaveLength(1);
    expect(screen.getPressable("Sign in with Google").props.accessibilityState).toEqual({ disabled: true, busy: true });

    returnFromBrowser({ type: "success", url: SIGNED_IN_URL });
    await settle();
    expect(texts()).toContain("Signing in…");
    expect(texts()).not.toContain("Opening Google…");

    finishExchange();
    await settle();
    expect(texts()).not.toContain("Signing in…");
    expect(screen.findAllByType("ActivityIndicator")).toHaveLength(0);
  });

  it("shows a social error under the brand buttons in red label type, naming Google (item 6)", async () => {
    const { render, browser } = setUp();
    browser.openAuthSessionAsync.mockResolvedValueOnce({ type: "success", url: `${SOCIAL_SIGN_IN_CALLBACK_URL}?error=server_error` });
    const screen = await render();
    await screen.press("I am 16 or older");
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    await screen.press("Sign in with Google");

    const texts = screen.findAllByType("Text");
    const error = texts.find((text) => textOf(text) === "Couldn't sign in with Google. Try again.");
    expect(error).toBeDefined();
    expect(texts.indexOf(error!)).toBeGreaterThan(texts.findIndex((text) => textOf(text) === "or"));
    expect(flattenStyle(error?.props.style)).toMatchObject({ color: colours.danger, fontSize: 13, lineHeight: 18 });
    expect(error?.props.accessibilityRole).toBe("alert");
  });
});
