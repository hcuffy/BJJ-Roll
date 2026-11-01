import { signUpAttestationDuties, SIGN_UP_ATTESTATION_LABEL, SIGN_UP_ATTESTATION_REFUSAL_MESSAGE, signUpAttestationVersion } from "@bjj-roll/shared";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMobileAuthClient } from "../auth/authClient";
import { SOCIAL_SIGN_IN_CALLBACK_URL, type AuthBrowser } from "../auth/socialSignIn";
import { EmailEntryScreen } from "../screens/EmailEntryScreen";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL } from "./authTestDoubles";
import { renderScreen } from "./screenHarness";

const VERSION_ID = signUpAttestationVersion.id;

describe("EmailEntryScreen sign-up attestation (HEN-183)", () => {
  let backend: ReturnType<typeof createFakeBackend>;
  let client: ReturnType<typeof createMobileAuthClient>;
  let browser: { openAuthSessionAsync: ReturnType<typeof vi.fn<AuthBrowser["openAuthSessionAsync"]>> };
  let codesSent: string[];

  beforeEach(() => {
    backend = createFakeBackend();
    client = createMobileAuthClient({
      backendUrl: TEST_BACKEND_URL,
      storage: createMemorySecureStore(),
      fetchImplementation: backend.fetchImplementation,
    });
    browser = {
      openAuthSessionAsync: vi.fn<AuthBrowser["openAuthSessionAsync"]>(() =>
        Promise.resolve({ type: "success", url: `${SOCIAL_SIGN_IN_CALLBACK_URL}?code=one-time-code` }),
      ),
    };
    codesSent = [];
  });

  const render = async () =>
    await renderScreen(
      createElement(EmailEntryScreen, {
        secureStore: createMemorySecureStore(),
        client,
        onCodeSent: (email) => codesSent.push(email),
        socialProviders: ["google"],
        socialSignIn: { client, secureStore: createMemorySecureStore(), backendUrl: TEST_BACKEND_URL, platform: "android", browser },
      }),
    );

  it("shows the three duties as the user's duties with the text version id, and an unticked accept box", async () => {
    const screen = await render();

    for (const duty of signUpAttestationDuties) {
      expect(screen.text()).toContain(duty);
    }
    expect(screen.text()).toContain(VERSION_ID);
    expect(screen.getByLabelText(SIGN_UP_ATTESTATION_LABEL).props.accessibilityState).toEqual({ checked: false, disabled: false });
  });

  it("with 16+ ticked but not the duties, the email buttons and Google say why and send nothing", async () => {
    const screen = await render();
    await screen.pressRole("checkbox");
    await screen.changeText("Email", "new.member@example.test");

    expect(screen.getPressable("Continue with email").props.accessibilityHint).toBe("Tick I accept these duties first.");
    await screen.press("Continue with email");
    expect(screen.text()).toContain(SIGN_UP_ATTESTATION_REFUSAL_MESSAGE);
    await screen.press("Email me a sign-in link instead");
    await screen.press("Sign in with Google");

    expect(backend.fetchImplementation).not.toHaveBeenCalled();
    expect(browser.openAuthSessionAsync).not.toHaveBeenCalled();
    expect(codesSent).toEqual([]);
  });

  it("once the duties are ticked, the code request carries the current text version id", async () => {
    const screen = await render();
    await screen.pressRole("checkbox");
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    expect(screen.text()).not.toContain(SIGN_UP_ATTESTATION_REFUSAL_MESSAGE);
    await screen.changeText("Email", "new.member@example.test");
    await screen.press("Continue with email");

    expect(codesSent).toEqual(["new.member@example.test"]);
    expect(backend.requests[0]?.body).toMatchObject({ age16Confirmed: true, signUpAttestationTextVersionId: VERSION_ID });
  });

  it("Google sign-in sends the version id once both boxes are ticked", async () => {
    const screen = await render();
    await screen.pressRole("checkbox");
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    await screen.press("Sign in with Google");

    const social = backend.requests.find((request) => request.url.endsWith("/sign-in/social"));
    expect(social?.body?.additionalData).toEqual({
      age16Confirmed: true,
      age18Confirmed: false,
      signUpAttestationTextVersionId: VERSION_ID,
      verifierHash: expect.any(String) as unknown,
    });
  });
});
