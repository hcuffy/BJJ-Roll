import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BiometricOfferScreen } from "../screens/BiometricOfferScreen";
import { colours, radius, sizes } from "../theme/tokens";
import { pressHardwareBack, resetBackListeners } from "./backHandlerHarness";
import { flattenStyle, renderScreen } from "./screenHarness";

const renderOffer = async (onDone: () => void = () => undefined, kind: "faceId" | "biometrics" = "biometrics") =>
  await renderScreen(createElement(BiometricOfferScreen, { kind, onTurnOn: () => Promise.resolve({ ok: true } as const), onDone }));

beforeEach(() => {
  resetBackListeners();
});

describe("BiometricOfferScreen design (Vera round 2)", () => {
  it("fix 1: 'Not now' is a dark secondary pill as tall as 'Turn on', and only 'Turn on' is lime", async () => {
    const screen = await renderOffer();
    const turnOn = flattenStyle(screen.getPressable("Turn on").props.style);
    const notNow = flattenStyle(screen.getPressable("Not now").props.style);

    expect(turnOn).toMatchObject({ backgroundColor: colours.primary, minHeight: sizes.buttonHeight });
    expect(notNow).toMatchObject({ backgroundColor: colours.surfaceRaised, minHeight: sizes.buttonHeight, borderRadius: radius.pill });
    expect(notNow.alignSelf).toBeUndefined();
    expect(notNow.width).toBeUndefined();
  });

  it.each(["biometrics", "faceId"] as const)("fix 7: says what it is for and that the %s data stays on the phone", async (kind) => {
    const text = (await renderOffer(undefined, kind)).text();

    expect(text).toContain("Keeps anyone else using this phone out of your BJJ Roll account.");
    expect(text).toMatch(/stays? on your phone\. BJJ Roll never sees (it|them)\./);
    expect(text).not.toMatch(/opens/);
  });

  it("fix 8: Android back on the offer is 'Not now', and stops listening once the offer is gone", async () => {
    const onDone = vi.fn();
    const shown = { offer: true };
    const Host = () =>
      shown.offer
        ? createElement(BiometricOfferScreen, { kind: "biometrics", onTurnOn: () => Promise.resolve({ ok: true } as const), onDone })
        : null;
    const screen = await renderScreen(createElement(Host));

    expect(pressHardwareBack()).toBe(true);
    expect(onDone).toHaveBeenCalledTimes(1);

    shown.offer = false;
    await screen.rerender();
    expect(pressHardwareBack()).toBe(false);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
