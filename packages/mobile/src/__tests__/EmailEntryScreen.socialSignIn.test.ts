import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMobileAuthClient } from "../auth/authClient";
import { SOCIAL_SIGN_IN_CALLBACK_URL, type SocialProvider, type SocialSignInDependencies } from "../auth/socialSignIn";
import { EmailEntryScreen } from "../screens/EmailEntryScreen";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL } from "./authTestDoubles";
import { renderScreen } from "./screenHarness";

describe("EmailEntryScreen with Apple and Google (HEN-239)", () => {
  let backend: ReturnType<typeof createFakeBackend>;
  let socialSignIn: SocialSignInDependencies & { browser: { openAuthSessionAsync: ReturnType<typeof vi.fn> } };
  let signedIn: number;

  beforeEach(() => {
    backend = createFakeBackend();
    const client = createMobileAuthClient({
      backendUrl: TEST_BACKEND_URL,
      storage: createMemorySecureStore(),
      fetchImplementation: backend.fetchImplementation,
    });
    socialSignIn = {
      client,
      backendUrl: TEST_BACKEND_URL,
      platform: "android",
      browser: { openAuthSessionAsync: vi.fn(() => Promise.resolve({ type: "success", url: `${SOCIAL_SIGN_IN_CALLBACK_URL}?code=one-time-code` })) },
    };
    signedIn = 0;
  });

  const renderWith = (socialProviders: readonly SocialProvider[]) =>
    renderScreen(
      createElement(EmailEntryScreen, {
        client: socialSignIn.client,
        onCodeSent: () => undefined,
        socialProviders,
        socialSignIn,
        onSignedIn: () => {
          signedIn += 1;
        },
      }),
    );

  it("shows Continue with Apple and Sign in with Google next to email, with no password field", async () => {
    const screen = await renderWith(["apple", "google"]);

    expect(screen.queryByText("Continue with Apple")).not.toBeNull();
    expect(screen.queryByLabelText("Sign in with Google")).not.toBeNull();
    expect(screen.queryByText("Continue with email")).not.toBeNull();
    expect(screen.findAllByType("TextInput").some((input) => input.props.secureTextEntry === true)).toBe(false);
  });

  it("shows no social buttons when none is configured", async () => {
    const screen = await renderWith([]);

    expect(screen.queryByText("Continue with Apple")).toBeNull();
    expect(screen.queryByLabelText("Sign in with Google")).toBeNull();
  });

  it("needs only the 16+ box: without it a tap explains and sends nothing; with it Google signs in", async () => {
    const screen = await renderWith(["google"]);

    expect(screen.getPressable("Sign in with Google").props.accessibilityHint).toBe("Tick the 16 or older box first.");
    await screen.press("Sign in with Google");
    expect(screen.text()).toContain("Tick the box to confirm you are 16 or older.");
    expect(backend.fetchImplementation).not.toHaveBeenCalled();
    expect(socialSignIn.browser.openAuthSessionAsync).not.toHaveBeenCalled();

    await screen.press("I am 16 or older");
    expect(screen.getPressable("Sign in with Google").props.accessibilityHint).toBeUndefined();
    await screen.press("Sign in with Google");

    expect(backend.requests.map((request) => new URL(request.url).pathname)).toEqual(["/api/auth/sign-in/social", "/api/auth/magic-link/exchange"]);
    expect(backend.requests[0]?.body).toMatchObject({ additionalData: { age16Confirmed: true, age18Confirmed: false } });
    expect(signedIn).toBe(1);
  });

  it("sends the 18+ box with Google the same way the email buttons do", async () => {
    const screen = await renderWith(["google"]);

    await screen.press("I am 16 or older");
    await screen.press("I am 18 or older");
    await screen.press("Sign in with Google");

    expect(backend.requests[0]?.body).toMatchObject({ additionalData: { age16Confirmed: true, age18Confirmed: true } });
    expect(signedIn).toBe(1);
  });

  it("shows neutral copy pointing to email sign-in when the provider's email cannot be used", async () => {
    socialSignIn.browser.openAuthSessionAsync.mockResolvedValueOnce({
      type: "success",
      url: `${SOCIAL_SIGN_IN_CALLBACK_URL}?error=account_not_linked`,
    });
    const screen = await renderWith(["google"]);

    await screen.press("I am 16 or older");
    await screen.press("Sign in with Google");

    expect(screen.text()).toContain("We couldn't sign you in with Google. Sign in with your email instead.");
    expect(screen.text()).not.toContain("account_not_linked");
    expect(signedIn).toBe(0);
  });
});
