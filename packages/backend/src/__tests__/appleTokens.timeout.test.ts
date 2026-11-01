import { afterEach, describe, expect, it, vi } from "vitest";
import { exchangeNativeAppleAuthorizationCode, revokeAppleRefreshToken, type AppleTokenClient } from "../auth/appleTokens.js";

const client = {
  config: { appBundleIdentifier: "com.example.bjjroll", serviceId: "com.example.bjjroll.web" },
  clientSecretFor: () => "client-secret",
} as unknown as AppleTokenClient;

function hangUntilAborted() {
  const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => AbortSignal.abort(new DOMException("timed out", "TimeoutError")));
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          if (init?.signal?.aborted) {
            reject(init.signal.reason as Error);
          }
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason as Error));
        }),
    ),
  );
  return timeoutSpy;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Apple token calls give up when Apple does not answer", () => {
  it("the native code exchange stops after 5 seconds instead of hanging sign-in", async () => {
    const timeoutSpy = hangUntilAborted();
    await expect(exchangeNativeAppleAuthorizationCode(client, "auth-code")).rejects.toThrow("timed out");
    expect(timeoutSpy).toHaveBeenCalledWith(5000);
  });

  it("the refresh-token revoke stops after 5 seconds instead of hanging account deletion", async () => {
    const timeoutSpy = hangUntilAborted();
    await expect(revokeAppleRefreshToken(client, { refreshToken: "refresh-token", clientId: null })).rejects.toThrow("timed out");
    expect(timeoutSpy).toHaveBeenCalledWith(5000);
  });
});
