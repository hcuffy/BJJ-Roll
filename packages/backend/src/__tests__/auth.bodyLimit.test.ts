import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { AUTH_REQUEST_BODY_LIMIT_BYTES } from "../auth/index.js";
import { socketEnvironment, testBaseUrl } from "./authTestHelper.js";

describe("HEN-71 auth body limit", () => {
  const app = createApp({
    auth: {
      handler: () => Promise.resolve(new Response(null, { status: 200 })),
      resolveSessionUserId: () => Promise.resolve(null),
    },
  });

  it("returns 413 for an oversized /api/auth body and lets a normal-size auth request through", async () => {
    const oversizedBody = JSON.stringify({ email: `${"x".repeat(AUTH_REQUEST_BODY_LIMIT_BYTES)}@example.test` });
    expect(new TextEncoder().encode(oversizedBody).byteLength).toBeGreaterThan(AUTH_REQUEST_BODY_LIMIT_BYTES);

    const oversized = await app.request(
      `${testBaseUrl}/api/auth/sign-in/email-otp`,
      { method: "POST", headers: { "content-type": "application/json" }, body: oversizedBody },
      socketEnvironment("198.51.100.20"),
    );
    expect(oversized.status).toBe(413);

    const normal = await app.request(
      `${testBaseUrl}/api/auth/sign-in/email-otp`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "member@example.test", otp: "123456" }),
      },
      socketEnvironment("198.51.100.21"),
    );
    expect(normal.status).not.toBe(413);
    expect(normal.status).toBe(200);
  });
});
