import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { AUTH_REQUEST_BODY_LIMIT_BYTES, type AuthInstance } from "../auth/index.js";
import { socketEnvironment, testBaseUrl } from "./authTestHelper.js";

// Pinned on purpose: the test must fail if the limit drifts from 32 KiB (for example to 1 MiB).
const expectedLimitBytes = 32 * 1024;

function authBodyOfSize(byteLength: number): string {
  const emptyBody = JSON.stringify({ email: "@example.test" });
  return JSON.stringify({ email: `${"x".repeat(byteLength - emptyBody.length)}@example.test` });
}

describe("HEN-71 auth body limit", () => {
  // No database is passed, so createApp mounts only /api/auth and uses only these two auth fields.
  const fakeAuth = {
    handler: () => Promise.resolve(new Response(null, { status: 200 })),
    resolveSessionUserId: () => Promise.resolve(null),
  } satisfies Pick<AuthInstance, "handler" | "resolveSessionUserId">;
  const app = createApp({ auth: fakeAuth as unknown as AuthInstance });

  const postAuth = (body: string, ipAddress: string, headers: Record<string, string> = {}) =>
    app.request(
      `${testBaseUrl}/api/auth/sign-in/email-otp`,
      { method: "POST", headers: { "content-type": "application/json", ...headers }, body },
      socketEnvironment(ipAddress),
    );

  it("keeps the limit at 32 KiB", () => {
    expect(AUTH_REQUEST_BODY_LIMIT_BYTES).toBe(expectedLimitBytes);
  });

  it("lets a body just under 32 KiB through and returns 413 for a body just over it", async () => {
    const justUnder = authBodyOfSize(expectedLimitBytes - 1);
    const justOver = authBodyOfSize(expectedLimitBytes + 1);
    expect(new TextEncoder().encode(justUnder).byteLength).toBe(expectedLimitBytes - 1);
    expect(new TextEncoder().encode(justOver).byteLength).toBe(expectedLimitBytes + 1);

    expect((await postAuth(justUnder, "198.51.100.21")).status).toBe(200);
    expect((await postAuth(justOver, "198.51.100.20")).status).toBe(413);
  });

  it("returns 413 when the Content-Length header is over 32 KiB", async () => {
    const response = await postAuth(JSON.stringify({ email: "member@example.test" }), "198.51.100.22", {
      "content-length": String(expectedLimitBytes + 1),
    });
    expect(response.status).toBe(413);
  });
});
