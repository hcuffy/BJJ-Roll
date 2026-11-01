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

  it("a browser on the sign-in link gets the 'Something went wrong' page instead of JSON, and logs the same line", async () => {
    const lines: ServerEventLine[] = [];

    const response = await appWithFailingAuth(lines).request("http://localhost:3000/api/auth/magic-link/verify?token=sample-token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "",
    });

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const html = await response.text();
    expect(html).toContain("<h1>Something went wrong</h1>");
    expect(html).toContain("<p>Open BJJ Roll and try again in a minute.</p>");
    expect(html).not.toMatch(/member@example\.test|"error"|<script/iu);
    expect(lines).toEqual([{ event: "request_failed", route: "/api/auth/*", errorClass: "TypeError" }]);
  });

  it("keeps HTTP errors that a route raised on purpose", async () => {
    const response = await createApp().request("/no-such-route");

    expect(response.status).toBe(404);
  });
});
