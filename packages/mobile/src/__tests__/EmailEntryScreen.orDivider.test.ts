import { createElement } from "react";
import { describe, expect, it } from "vitest";
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
    platform: "android" as const,
    browser: { openAuthSessionAsync: () => Promise.resolve({ type: "cancel" as const }) },
  };
  return await renderScreen(createElement(EmailEntryScreen, { client, onCodeSent: () => undefined, socialProviders, socialSignIn }));
}

const dividerRow = (screen: Awaited<ReturnType<typeof renderSignIn>>) =>
  screen.findAllByType("View").filter((node) => textOf(node) === "or" && node.children.length === 3);

describe("HEN-239 sign-in order: email, 'or' divider, 16+ line, brand buttons (Vera Round 4 item 4, interim item 2, Henry Q4)", () => {
  it("puts the email buttons first, the 'or' row next, and the brand buttons after it", async () => {
    const screen = await renderSignIn(["apple", "google"]);
    const texts = screen.findAllByType("Text").map(textOf);
    const at = (text: string) => texts.indexOf(text);

    expect(at("Continue with email")).toBeGreaterThanOrEqual(0);
    expect(at("Continue with email")).toBeLessThan(at("Email me a sign-in link instead"));
    expect(at("Email me a sign-in link instead")).toBeLessThan(at("or"));
    // Vera interim item 2: the muted 16+ line sits between the divider and the brand buttons.
    expect(at("or")).toBeLessThan(at("Tick the 16 or older box first."));
    expect(at("Tick the 16 or older box first.")).toBeLessThan(at("Continue with Apple"));
    // Google's button is an image with no Text, so check it comes after Apple among the buttons.
    const buttons = screen.pressables().map((node) => (node.props.accessibilityLabel as string | undefined) ?? textOf(node));
    expect(buttons.indexOf("Continue with Apple")).toBeGreaterThan(buttons.indexOf("Continue with email"));
    expect(buttons.indexOf("Sign in with Google")).toBeGreaterThan(buttons.indexOf("Continue with Apple"));
  });

  it("the 'or' row: muted Label 13/18 between two 1pt border-colour lines, 24 from its neighbours, hidden from screen readers", async () => {
    const screen = await renderSignIn(["google"]);
    const [row, ...others] = dividerRow(screen);

    expect(others).toHaveLength(0);
    expect(row?.props).toMatchObject({ accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants" });
    // The actions stack has a 16 gap; the row adds 8 each side to make Vera's 24.
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
