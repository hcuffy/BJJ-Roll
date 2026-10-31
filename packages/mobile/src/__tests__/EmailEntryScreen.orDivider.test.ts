import { createElement } from "react";
import { Platform } from "react-native";
import { afterEach, describe, expect, it } from "vitest";
import { createMobileAuthClient } from "../auth/authClient";
import type { SocialProvider } from "../auth/socialSignIn";
import { EmailEntryScreen } from "../screens/EmailEntryScreen";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL } from "./authTestDoubles";
import { flattenStyle, renderScreen, textOf } from "./screenHarness";

async function renderSignIn(socialProviders: readonly SocialProvider[]) {
  const client = createMobileAuthClient({
    backendUrl: TEST_BACKEND_URL,
    storage: createMemorySecureStore(),
    fetchImplementation: createFakeBackend().fetchImplementation,
  });
  const socialSignIn = {
    client,
    backendUrl: TEST_BACKEND_URL,
    platform: Platform.OS,
    browser: { openAuthSessionAsync: () => Promise.resolve({ type: "cancel" as const }) },
  };
  return await renderScreen(createElement(EmailEntryScreen, { client, onCodeSent: () => undefined, socialProviders, socialSignIn }));
}

const dividerRow = (screen: Awaited<ReturnType<typeof renderSignIn>>) =>
  screen.findAllByType("View").filter((node) => textOf(node) === "or" && node.children.length === 3);

describe("HEN-239 sign-in order: email, 'or' divider, 16+ line, brand buttons (Vera Round 4 item 4, interim item 2, Henry Q4)", () => {
  afterEach(() => {
    Platform.OS = "android";
  });

  it("puts the email buttons first, the 'or' row next, and the brand buttons after it", async () => {
    Platform.OS = "ios";
    const screen = await renderSignIn(["apple", "google"]);
    const texts = screen.findAllByType("Text").map(textOf);
    const at = (text: string) => texts.indexOf(text);

    expect(at("Continue with email")).toBeGreaterThanOrEqual(0);
    expect(at("Continue with email")).toBeLessThan(at("Email me a sign-in link instead"));
    expect(at("Email me a sign-in link instead")).toBeLessThan(at("or"));
    expect(at("or")).toBeLessThan(at("Tick the 16 or older box first."));
    const [apple] = screen.findAllByType("AppleAuthenticationButton");
    const pressables = screen.pressables();
    expect(pressables.indexOf(apple!)).toBeGreaterThan(pressables.indexOf(screen.getPressable("Continue with email")));
    expect(pressables.indexOf(screen.getPressable("Sign in with Google"))).toBeGreaterThan(pressables.indexOf(apple!));
  });

  it("the 'or' row: muted Label 13/18 between two 1pt border-colour lines, 24 from its neighbours, hidden from screen readers", async () => {
    const screen = await renderSignIn(["google"]);
    const [row, ...others] = dividerRow(screen);

    expect(others).toHaveLength(0);
    expect(row?.props).toMatchObject({ accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants" });
    expect(flattenStyle(row?.props.style)).toMatchObject({ flexDirection: "row", alignItems: "center", marginVertical: 8 });
    const [lineBefore, word, lineAfter] = row?.children ?? [];
    for (const line of [lineBefore, lineAfter]) {
      expect(typeof line === "object" && flattenStyle(line.props.style)).toMatchObject({ flex: 1, height: 1, backgroundColor: "#7A7D7A" });
    }
    expect(typeof word === "object" && flattenStyle(word.props.style)).toMatchObject({ fontSize: 13, lineHeight: 18, color: "#A0A3A0" });
  });

  it("shows no 'or' row when there are no brand buttons", async () => {
    const screen = await renderSignIn([]);

    expect(dividerRow(screen)).toHaveLength(0);
    expect(screen.findAllByType("Text").map(textOf)).not.toContain("or");
  });
});
