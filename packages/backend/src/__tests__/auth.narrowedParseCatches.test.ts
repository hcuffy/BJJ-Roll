import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeCreateData } from "../auth/authCodecTransform.js";
import { createAuthCryptoCodec, generateTestAuthSecrets, isAllowedDeepLinkCallbackUrl, loadAuthKeyringFromEnvironment } from "../auth/index.js";
import { refuseUnsafeAppleIdToken } from "../auth/socialSignInSafety.js";
import type { AuthMiddlewareContext } from "../auth/types.js";

const codec = createAuthCryptoCodec(loadAuthKeyringFromEnvironment(generateTestAuthSecrets()));
const otherError = new RangeError("not a parse failure");
const throwOtherError = () => {
  throw otherError;
};

const appleSignIn = (payload: string) =>
  ({
    path: "/sign-in/social",
    body: { provider: "apple", idToken: { token: `header.${Buffer.from(payload).toString("base64url")}.signature`, nonce: "n".repeat(32) } },
  }) as unknown as AuthMiddlewareContext;

describe("B1 Q8: narrowed parse catches in src/auth give null or false only for their own error type", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("authCodecTransform: a verification value that is not JSON stores without an email; any other error is rethrown", () => {
    const { emailHmac, encoded } = encodeCreateData("verification", { identifier: "plain-identifier", value: "{not json" }, codec);
    expect(emailHmac).toBeNull();
    expect(typeof encoded.value).toBe("string");

    vi.spyOn(JSON, "parse").mockImplementation(throwOtherError);
    expect(() => encodeCreateData("verification", { identifier: "plain-identifier", value: "{}" }, codec)).toThrow(otherError);
  });

  it("socialSignInSafety: an Apple id token whose claims are not JSON is an invalid token; any other error is rethrown", async () => {
    const pool = {} as Pool;
    await expect(refuseUnsafeAppleIdToken(appleSignIn("{not json"), pool)).rejects.toMatchObject({ body: { code: "INVALID_TOKEN" } });

    vi.spyOn(JSON, "parse").mockImplementation(throwOtherError);
    await expect(refuseUnsafeAppleIdToken(appleSignIn("{}"), pool)).rejects.toBe(otherError);
  });

  it("deepLinkCallback: a malformed percent escape is refused; any other decode error is rethrown", () => {
    expect(isAllowedDeepLinkCallbackUrl("bjjroll://auth/%E0%A4%A")).toBe(false);

    vi.stubGlobal("decodeURIComponent", throwOtherError);
    expect(() => isAllowedDeepLinkCallbackUrl("bjjroll://auth/next")).toThrow(otherError);
  });

  it("deepLinkCallback: a URL the parser refuses is not allowed; any other URL error is rethrown", () => {
    const nativeUrl = URL;
    const urlThrowing = (error: Error) =>
      class extends nativeUrl {
        constructor(input: string | URL, base?: string | URL) {
          if (String(input).startsWith("bjjroll://auth/refused")) {
            throw error;
          }
          super(input, base);
        }
      };
    vi.stubGlobal("URL", urlThrowing(new TypeError("Invalid URL")));
    expect(isAllowedDeepLinkCallbackUrl("bjjroll://auth/refused")).toBe(false);
    expect(isAllowedDeepLinkCallbackUrl("bjjroll://auth/next")).toBe(true);

    vi.stubGlobal("URL", urlThrowing(otherError));
    expect(() => isAllowedDeepLinkCallbackUrl("bjjroll://auth/refused")).toThrow(otherError);
  });
});
