import { describe, expect, it } from "vitest";
import { createApp, type CreateAppOptions } from "../app.js";
import type { ServerEventLine } from "../serverProcess.js";

const secretDetail = "member@example.test leaked in an error message";

function appWithFailingAuth(lines: ServerEventLine[]) {
  const auth = {
    handler: () => Promise.reject(new TypeError(secretDetail)),
  } as unknown as NonNullable<CreateAppOptions["auth"]>;
  return createApp({ auth, logServerEvent: (line) => lines.push(line) });
}

describe("B14 an unhandled error returns a plain 500 and logs only the route and error class", () => {
  it("answers 500 JSON with no message and logs {route, errorClass}", async () => {
    const lines: ServerEventLine[] = [];

    const response = await appWithFailingAuth(lines).request("/api/auth/get-session");

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "internal" });
    expect(lines).toEqual([{ event: "request_failed", route: "/api/auth/*", errorClass: "TypeError" }]);
    expect(JSON.stringify(lines)).not.toContain("member@example.test");
  });

  it("keeps HTTP errors that a route raised on purpose", async () => {
    const response = await createApp().request("/no-such-route");

    expect(response.status).toBe(404);
  });
});
