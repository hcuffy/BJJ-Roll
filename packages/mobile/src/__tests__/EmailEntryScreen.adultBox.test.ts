import { SIGN_UP_ATTESTATION_LABEL } from "@bjj-roll/shared";
import { createElement } from "react";
import { AccessibilityInfo, Platform } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMobileAuthClient } from "../auth/authClient";
import { AGE_GATE_REFUSAL_MESSAGE } from "../auth/ageConfirmation";
import { FAILURE_MESSAGES, type FailureReason } from "../auth/signInActions";
import { EmailEntryScreen, TICK_AGE_BOX_MESSAGE } from "../screens/EmailEntryScreen";
import { colours } from "../theme/tokens";
import { createFakeBackend, createMemorySecureStore, TEST_BACKEND_URL } from "./authTestDoubles";
import { flattenStyle, renderScreen, textOf } from "./screenHarness";

const ADULT = "I am 18 or older";
const HAVE_ACCOUNT = "Already have an account? Confirm in Account.";
const NOTE = `Only needed to buy things later. ${HAVE_ACCOUNT}`;

const LINK_NEXT_STEP = "Tick I am 16 or older and send a new link.";

describe("EmailEntryScreen optional 18+ box (HEN-263, Vera items 1, 2 and 8; delta items 2, 3 and 6)", () => {
  let backend: ReturnType<typeof createFakeBackend>;

  beforeEach(() => {
    backend = createFakeBackend();
    vi.mocked(AccessibilityInfo.announceForAccessibility).mockClear();
  });

  afterEach(() => {
    Platform.OS = "android";
  });

  const render = (linkError: string | null = null, linkErrorReason: FailureReason | null = null) =>
    renderScreen(
      createElement(EmailEntryScreen, {
        linkError,
        linkErrorReason,
        client: createMobileAuthClient({
          backendUrl: TEST_BACKEND_URL,
          storage: createMemorySecureStore(),
          fetchImplementation: backend.fetchImplementation,
        }),
        onCodeSent: () => undefined,
      }),
    );

  it("groups the optional 18+ row under 16+: 8 apart, indented 36, with a muted note under it", async () => {
    const screen = await render();
    const views = screen.findAllByType("View");
    const group = views.find((view) => flattenStyle(view.props.style).gap === 8 && textOf(view).includes(ADULT));
    expect(textOf(group ?? "")).toContain("I am 16 or older");
    const indented = views.find((view) => flattenStyle(view.props.style).marginLeft === 36);
    expect(textOf(indented ?? "")).toContain(ADULT);
    expect(textOf(indented ?? "")).toContain(NOTE);
    expect(textOf(indented ?? "")).not.toContain("I am 16 or older");
    expect(flattenStyle(screen.queryByText(NOTE)?.props.style)).toMatchObject({ color: colours.textSecondary, fontSize: 15, lineHeight: 22 });
  });

  it("Henry Q3 / Vera item 3: the sign-up 18+ box points users who already have an account to Account", async () => {
    const screen = await render();
    const indented = screen.findAllByType("View").find((view) => flattenStyle(view.props.style).marginLeft === 36);
    expect(textOf(indented ?? "")).toContain(ADULT);
    expect(textOf(indented ?? "")).toContain(HAVE_ACCOUNT);
    expect(screen.text().indexOf(HAVE_ACCOUNT)).toBeGreaterThan(screen.text().indexOf(ADULT));
  });

  it("keeps 18+ disabled and dimmed until 16+ is ticked; unticking 16+ unticks 18+; 18+ never ticks 16+", async () => {
    const screen = await render();
    const adult = () => screen.getByLabelText(ADULT);
    const adultBoxStyle = () => {
      const box = adult().children.find((child) => typeof child !== "string" && child.type === "View");
      return flattenStyle(typeof box === "string" ? undefined : box?.props.style);
    };

    expect(adult().props).toMatchObject({
      disabled: true,
      accessibilityState: { checked: false, disabled: true },
      accessibilityHint: "Tick I am 16 or older first.",
    });
    expect(adultBoxStyle().borderColor).toBe(colours.border);
    expect(flattenStyle(screen.queryByText(ADULT)?.props.style).color).toBe(colours.textSecondary);
    expect(screen.getByRole("checkbox").props.accessibilityState).toEqual({ checked: false, disabled: false });

    await screen.pressRole("checkbox");
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    expect(adult().props).toMatchObject({ disabled: false, accessibilityState: { checked: false, disabled: false } });
    expect(adult().props.accessibilityHint).toBeUndefined();
    expect(adultBoxStyle().borderColor).toBe(colours.textSecondary);
    expect(flattenStyle(screen.queryByText(ADULT)?.props.style).color).toBe(colours.textPrimary);

    (adult().props.onPress as () => void)();
    await screen.rerender();
    expect(adult().props.accessibilityState).toEqual({ checked: true, disabled: false });

    await screen.pressRole("checkbox");
    await screen.press(SIGN_UP_ATTESTATION_LABEL);
    expect(screen.getByRole("checkbox").props.accessibilityState).toEqual({ checked: false, disabled: false });
    expect(adult().props.accessibilityState).toEqual({ checked: false, disabled: true });
  });

  it("an empty submit shows both errors but announces only the first: the second is a polite live region without role alert", async () => {
    Platform.OS = "ios";
    const screen = await render();
    await screen.press("Continue with email");

    expect(backend.fetchImplementation).not.toHaveBeenCalled();
    expect(screen.queryByText(FAILURE_MESSAGES.invalidEmail)?.props).toMatchObject({ accessibilityLiveRegion: "polite", accessibilityRole: "alert" });
    const ageError = screen.queryByText(TICK_AGE_BOX_MESSAGE);
    expect(ageError?.props.accessibilityLiveRegion).toBe("polite");
    expect(ageError?.props.accessibilityRole).toBeUndefined();
    expect(vi.mocked(AccessibilityInfo.announceForAccessibility).mock.calls).toEqual([[FAILURE_MESSAGES.invalidEmail]]);
  });

  it("announces the 16+ error when it is the only thing missing", async () => {
    Platform.OS = "ios";
    const screen = await render();
    await screen.changeText("Email", "member@example.test");
    await screen.press("Continue with email");

    expect(screen.queryByText(TICK_AGE_BOX_MESSAGE)?.props.accessibilityRole).toBe("alert");
    expect(vi.mocked(AccessibilityInfo.announceForAccessibility).mock.calls).toEqual([[TICK_AGE_BOX_MESSAGE]]);
  });

  it("delta 6: with the email error already showing from blur, an empty submit announces the 16+ error instead", async () => {
    Platform.OS = "ios";
    const screen = await render();
    await screen.changeText("Email", "not-an-email");
    await screen.fire("Email", "onBlur");
    expect(vi.mocked(AccessibilityInfo.announceForAccessibility).mock.calls).toEqual([[FAILURE_MESSAGES.invalidEmail]]);

    await screen.press("Continue with email");
    expect(screen.queryByText(TICK_AGE_BOX_MESSAGE)?.props.accessibilityRole).toBe("alert");
    expect(vi.mocked(AccessibilityInfo.announceForAccessibility).mock.calls).toEqual([[FAILURE_MESSAGES.invalidEmail], [TICK_AGE_BOX_MESSAGE]]);
  });

  it("delta 2 / round 4 item 1: a link refused for age stacks the next step under the refusal in one card body, in body text", async () => {
    const refused = await render(AGE_GATE_REFUSAL_MESSAGE, "ageRequired");
    const card = refused.findAllByType("View").find((view) => flattenStyle(view.props.style).borderColor === colours.danger);
    // The card is a row (icon slot + body); both lines sit in one column body, like the "Check your email" card.
    const cardChildren = card?.children.filter((child) => typeof child !== "string") ?? [];
    expect(cardChildren).toHaveLength(1);
    const [body] = cardChildren as { props: Record<string, unknown> }[];
    expect(flattenStyle(body?.props.style)).toMatchObject({ flex: 1, gap: 8 });
    expect(textOf(body as never)).toBe(`${AGE_GATE_REFUSAL_MESSAGE}${LINK_NEXT_STEP}`);
    expect(flattenStyle(refused.queryByText(LINK_NEXT_STEP)?.props.style).color).toBe(colours.textPrimary);

    const invalid = await render(FAILURE_MESSAGES.invalidLink, "invalidLink");
    expect(invalid.text()).toContain("This sign-in link has expired or was already used. Send a new one.");
    expect(invalid.queryByText(LINK_NEXT_STEP)).toBeNull();
  });

  it("round 4 item 4: the next step follows the age_refused reason, not the refusal text", async () => {
    const textOnly = await render(AGE_GATE_REFUSAL_MESSAGE);
    expect(textOnly.queryByText(LINK_NEXT_STEP)).toBeNull();

    const editedCopy = await render("Edited refusal copy.", "ageRequired");
    expect(editedCopy.queryByText(LINK_NEXT_STEP)).not.toBeNull();
  });
});
