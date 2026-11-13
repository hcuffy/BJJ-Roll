import { HTTPException } from "hono/http-exception";
import { describe, expect, it, vi } from "vitest";
import { createApp, type CreateAppOptions } from "../app.js";
import type { ServerEventLine } from "../serverProcess.js";

const secretDetail = "member@example.test leaked in an error message";

function appWithFailingAuth(lines: ServerEventLine[]) {
  const auth = {
    handler: () => Promise.reject(new TypeError(secretDetail)),
  } as unknown as NonNullable<CreateAppOptions["auth"]>;
  return createApp({ auth, logServerEvent: (line) => lines.push(line) });
}

const verifyUrl = "http://localhost:3000/api/auth/magic-link/verify?token=sample-token";

function browserContinue(): RequestInit {
  return { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "" };
}

async function expectTroublePage(response: Response): Promise<void> {
  expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
  const html = await response.text();
  expect(html).toContain("<title>Something went wrong with BJJ Roll sign-in</title>");
  expect(html).toContain("<h1>Something went wrong</h1>");
  expect(html).toContain("<p>Open BJJ Roll and try again in a minute.</p>");
  expect(html).not.toMatch(/member@example\.test|"error"|unavailable|<script/iu);
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
    expect(html).toContain("<title>Something went wrong with BJJ Roll sign-in</title>");
    expect(html).toContain("<h1>Something went wrong</h1>");
    expect(html).toContain("<p>Open BJJ Roll and try again in a minute.</p>");
    expect(html).not.toMatch(/member@example\.test|"error"|<script/iu);
    expect(lines).toEqual([{ event: "request_failed", route: "/api/auth/*", errorClass: "TypeError" }]);
  });

  it.each([503, 429] as const)("a deliberate %s on the sign-in link shows a browser the 'Something went wrong' page (Vera 2)", async (status) => {
    const failure = () => new HTTPException(status, { res: Response.json({ error: "unavailable" }, { status }) });
    const auth = { handler: () => Promise.reject(failure()) } as unknown as NonNullable<CreateAppOptions["auth"]>;
    const app = createApp({ auth, logServerEvent: () => undefined });

    const browser = await app.request(verifyUrl, browserContinue());
    const appRequest = await app.request("/api/auth/get-session");

    expect(browser.status).toBe(status);
    await expectTroublePage(browser);
    expect(appRequest.status).toBe(status);
    expect(await appRequest.json()).toEqual({ error: "unavailable" });
  });

  it("an error in the middleware ahead of the auth handler still shows a browser the 'Something went wrong' page (Vera 4)", async () => {
    const lines: ServerEventLine[] = [];
    const handler = vi.fn();
    const auth = { handler } as unknown as NonNullable<CreateAppOptions["auth"]>;
    const brokenBody = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new TypeError(secretDetail));
      },
    });

    const response = await createApp({ auth, logServerEvent: (line) => lines.push(line) }).request(verifyUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: brokenBody,
      duplex: "half",
    });

    expect(handler).not.toHaveBeenCalled();
    expect(response.status).toBe(500);
    await expectTroublePage(response);
    expect(lines).toEqual([{ event: "request_failed", route: "/api/auth/*", errorClass: "TypeError" }]);
  });

  it("keeps HTTP errors that a route raised on purpose", async () => {
    const response = await createApp().request("/no-such-route");

    expect(response.status).toBe(404);
  });
});
