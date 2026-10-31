import { describe, expect, it } from "vitest";
import appConfig from "../../app.json";

describe("HEN-288 iOS Face ID usage description", () => {
  it("explains in app.json why the app asks for Face ID", () => {
    const ios: { infoPlist?: { NSFaceIDUsageDescription?: unknown } } = appConfig.expo.ios;
    expect(ios.infoPlist?.NSFaceIDUsageDescription).toEqual(expect.stringMatching(/\S/));
  });
});
