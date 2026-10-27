import { describe, expect, it } from "vitest";
import appConfig from "../../app.json";

describe("HEN-273 iOS export compliance", () => {
  // The app only uses exempt encryption (HTTPS, OS hashing and random bytes), so App Store Connect need not ask on each upload.
  it("declares no non-exempt encryption, so App Store upload does not stop to ask", () => {
    const ios: { config?: { usesNonExemptEncryption?: unknown } } = appConfig.expo.ios;
    expect(ios.config?.usesNonExemptEncryption).toBe(false);
  });
});
