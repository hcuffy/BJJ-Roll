import { AGE_GATE_REFUSAL_MESSAGE } from "@bjj-roll/shared";
import { createElement } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { createMobileAuthClient } from "../auth/authClient";
import { CodeEntryScreen } from "../screens/CodeEntryScreen";
import { EmailEntryScreen } from "../screens/EmailEntryScreen";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL } from "./authTestDoubles";
import { renderScreen } from "./screenHarness";

describe("EmailEntryScreen", () => {
  let backend: ReturnType<typeof createFakeBackend>;
  let client: ReturnType<typeof createMobileAuthClient>;
  let sentTo: string[];

  beforeEach(() => {
    backend = createFakeBackend();
    client = createMobileAuthClient({
      backendUrl: TEST_BACKEND_URL,
      storage: createMemorySecureStore(),
      fetchImplementation: backend.fetchImplementation,
    });
    sentTo = [];
  });

  const renderEmailEntry = () => renderScreen(createElement(EmailEntryScreen, { client, onCodeSent: (email) => sentTo.push(email) }));

  it("shows the 17+ checkbox unticked and an email field without a password field", async () => {
    const screen = await renderEmailEntry();

    expect(screen.getByRole("checkbox").props.accessibilityState).toEqual({ checked: false });
    expect(screen.queryByText("I am 17 or older")).not.toBeNull();
    expect(screen.findAllByType("TextInput").map((input) => input.props.accessibilityLabel)).toEqual(["Email"]);
    expect(screen.findAllByType("TextInput").some((input) => input.props.secureTextEntry === true)).toBe(false);
  });

  it("keeps Continue and the link button disabled and sends nothing until the box is ticked", async () => {
    const screen = await renderEmailEntry();
    await screen.changeText("Email", "member@example.test");

    expect(screen.isDisabled("Continue")).toBe(true);
    expect(screen.isDisabled("Email me a sign-in link instead")).toBe(true);
    await screen.press("Continue");
    await screen.press("Email me a sign-in link instead");

    expect(backend.fetchImplementation).not.toHaveBeenCalled();
    expect(sentTo).toEqual([]);
  });

  it("sends the code request with ageConfirmed true once ticked, then hands over the email", async () => {
    const screen = await renderEmailEntry();
    await screen.changeText("Email", " member@example.test ");
    await screen.pressRole("checkbox");

    expect(screen.isDisabled("Continue")).toBe(false);
    await screen.press("Continue");

    expect(backend.requests.map((request) => [new URL(request.url).pathname, request.body])).toEqual([
      ["/api/auth/email-otp/send-verification-otp", { email: "member@example.test", type: "sign-in", ageConfirmed: true }],
    ]);
    expect(sentTo).toEqual(["member@example.test"]);
  });

  it("shows the shared 17+ refusal message when the backend refuses with AGE_CONFIRMATION_REQUIRED", async () => {
    const serverWording = "Server wording for the age gate";
    backend.fetchImplementation.mockImplementationOnce(() =>
      Promise.resolve(Response.json({ code: "AGE_CONFIRMATION_REQUIRED", message: serverWording }, { status: 400 })),
    );
    const screen = await renderEmailEntry();
    await screen.changeText("Email", "member@example.test");
    await screen.pressRole("checkbox");
    await screen.press("Continue");

    expect(screen.queryByText(AGE_GATE_REFUSAL_MESSAGE)).not.toBeNull();
    expect(sentTo).toEqual([]);
  });
});

describe("CodeEntryScreen", () => {
  it("enables Sign in only for 6 digits and signs in with ageConfirmed true", async () => {
    const backend = createFakeBackend();
    const client = createMobileAuthClient({
      backendUrl: TEST_BACKEND_URL,
      storage: createMemorySecureStore(),
      fetchImplementation: backend.fetchImplementation,
    });
    let signedIn = false;
    const screen = await renderScreen(
      createElement(CodeEntryScreen, { client, email: "member@example.test", onSignedIn: () => (signedIn = true), onBack: () => undefined }),
    );

    expect(screen.text()).toContain("We emailed a 6-digit code to member@example.test.");
    await screen.changeText("6-digit code", "12345");
    expect(screen.isDisabled("Sign in")).toBe(true);
    await screen.changeText("6-digit code", "123456");
    await screen.press("Sign in");

    expect(backend.requests.at(-1)?.body).toEqual({ email: "member@example.test", otp: "123456", ageConfirmed: true });
    expect(signedIn).toBe(true);
  });
});
