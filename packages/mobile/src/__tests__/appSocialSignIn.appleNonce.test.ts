/// <reference types="node" />
import { createHash } from "node:crypto";
import * as AppleAuthentication from "expo-apple-authentication";
import { describe, expect, it, vi } from "vitest";
import { appSocialSignIn } from "../auth/appSocialSignIn";

vi.mock("../auth/appAuthClient", () => ({ appAuthClient: null, appSecureStore: null, appBackendUrl: "http://backend.test" }));

describe("HEN-239 the app's Apple nonce (expo-crypto)", () => {
  const appleNative = appSocialSignIn.appleNative;

  it("makes a fresh 256-bit random nonce for every sign-in", () => {
    const first = appleNative?.createNonce() ?? "";
    const second = appleNative?.createNonce() ?? "";

    expect(first).toMatch(/^[0-9a-f]{64}$/u);
    expect(second).toMatch(/^[0-9a-f]{64}$/u);
    expect(second).not.toBe(first);
  });

  it("hashes with SHA-256 (hex) and hands Apple only the hash, with the email scope", async () => {
    expect(await appleNative?.sha256Hex("raw-nonce")).toBe(createHash("sha256").update("raw-nonce").digest("hex"));

    await appleNative?.signInAsync("hashed-nonce").catch(() => undefined);

    expect(vi.mocked(AppleAuthentication.signInAsync)).toHaveBeenCalledWith({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL],
      nonce: "hashed-nonce",
    });
  });
});
