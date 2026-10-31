import { describe, expect, it } from "vitest";
import appConfig from "../../app.json";

describe("HEN-273 iOS export compliance", () => {
  it("declares no non-exempt encryption, so App Store upload does not stop to ask", () => {
    const ios: { config?: { usesNonExemptEncryption?: unknown } } = appConfig.expo.ios;
    expect(ios.config?.usesNonExemptEncryption).toBe(false);
  });
});
