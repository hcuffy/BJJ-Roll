import { SIGN_UP_ATTESTATION_DUTIES, SIGN_UP_ATTESTATION_LABEL } from "@bjj-roll/shared";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ATTESTATION_LEAD, ATTESTATION_VERSION_NOTE } from "../auth/signUpAttestation";
import { SignUpAttestationFields } from "../screens/SignUpAttestationFields";
import { colours, radius, spacing, typeScale } from "../theme/tokens";
import { flattenStyle, renderScreen, textOf } from "./screenHarness";

// Vera's design review of #74 (27 Oct), items 4-6: one card for the duties, a lead line, quiet bullets and a small version note.
describe("SignUpAttestationFields design (HEN-183)", () => {
  const render = async () => await renderScreen(createElement(SignUpAttestationFields, { accepted: false, error: null, onPress: () => undefined }));

  it("puts the lead line, duties, version note and box in one surface card, 24 below the previous block", async () => {
    const screen = await render();
    const cards = screen.findAllByType("View").filter((node) => flattenStyle(node.props.style).backgroundColor === colours.surface);
    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(flattenStyle(card?.props.style)).toMatchObject({ borderRadius: radius.card, padding: spacing.medium, marginTop: spacing.small });
    const cardText = card ? textOf(card) : "";
    for (const part of [ATTESTATION_LEAD, ...SIGN_UP_ATTESTATION_DUTIES, ATTESTATION_VERSION_NOTE, SIGN_UP_ATTESTATION_LABEL]) {
      expect(cardText).toContain(part);
    }
    expect(cardText.indexOf(ATTESTATION_LEAD)).toBeLessThan(cardText.indexOf(SIGN_UP_ATTESTATION_DUTIES[0] ?? ""));
  });

  it("the lead line is Body semibold white", async () => {
    const screen = await render();
    expect(flattenStyle(screen.queryByText(ATTESTATION_LEAD)?.props.style)).toMatchObject({
      ...typeScale.body,
      fontWeight: "600",
      color: colours.textPrimary,
    });
  });

  it("each duty is its own line and its bullet is hidden from screen readers", async () => {
    const screen = await render();
    for (const duty of SIGN_UP_ATTESTATION_DUTIES) {
      const dutyText = screen.findAllByType("Text").find((node) => textOf(node) === duty);
      expect(dutyText).toBeTruthy();
    }
    const bullets = screen.findAllByType("Text").filter((node) => textOf(node).trim() === "•");
    expect(bullets).toHaveLength(SIGN_UP_ATTESTATION_DUTIES.length);
    for (const bullet of bullets) {
      expect(bullet.props).toMatchObject({ accessibilityElementsHidden: true, importantForAccessibility: "no" });
    }
  });

  it("the version note is Caption, muted", async () => {
    const screen = await render();
    expect(flattenStyle(screen.queryByText(ATTESTATION_VERSION_NOTE)?.props.style)).toMatchObject({
      ...typeScale.caption,
      color: colours.textSecondary,
    });
  });
});
