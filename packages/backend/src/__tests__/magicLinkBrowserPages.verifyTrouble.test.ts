import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_VERIFIES_PER_IP_PER_WINDOW } from "../auth/index.js";
import { normalizeMagicLinkVerifyResponse } from "../auth/authRequestGuards.js";
import { continueMagicLink, startAuthTestEnvironment, testBaseUrl, type StartedAuthTestEnvironment } from "./authTestHelper.js";
import { isPostgresTestEnvironmentAvailable } from "./databaseTestHarness.js";

const verifyRequest = new Request("http://localhost:3000/api/auth/magic-link/verify?token=sample-token&callbackURL=bjjroll%3A%2F%2Fauth%2Fcallback");
const appSignInRequest = new Request("http://localhost:3000/api/auth/sign-in/magic-link", { method: "POST" });

function jsonResponse(status: number, code: string): Response {
  return new Response(JSON.stringify({ code, message: `${code} detail` }), { status, headers: { "content-type": "application/json" } });
}

describe("a sign-in link the server cannot finish shows a safe browser page, never raw JSON (Sara, 1 Nov)", () => {
  it.each([
    [500, "INTERNAL_SERVER_ERROR"],
    [429, "TOO_MANY_REQUESTS"],
  ] as const)("a %s on the link shows the dark 'Something went wrong' page", async (status, code) => {
    const response = normalizeMagicLinkVerifyResponse(verifyRequest, jsonResponse(status, code));

    expect(response.status).toBe(status);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
    );
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("location")).toBeNull();
    const html = await response.text();
    expect(html).toContain("<title>Something went wrong with BJJ Roll sign-in</title>");
    expect(html).toContain("<h1>Something went wrong</h1>");
    expect(html).toContain("<p>Open BJJ Roll and try again in a minute.</p>");
    expect(html).toMatch(/body \{[^}]*background: #111313;[^}]*color: #FFFFFF;/u);
    expect(html).not.toMatch(/<script|<form|<button|detail|"code"/iu);
  });

  it("a link whose redirect is not the app's deep link shows the 'Something went wrong' page, not JSON", async () => {
    const offsite = new Response(null, { status: 302, headers: { location: "https://evil.example.com/steal?code=one-time-code" } });

    const response = normalizeMagicLinkVerifyResponse(verifyRequest, offsite);

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("location")).toBeNull();
    const html = await response.text();
    expect(html).toContain("<h1>Something went wrong</h1>");
    expect(html).toContain("<p>Open BJJ Roll and try again in a minute.</p>");
    expect(html).not.toMatch(/<script|INVALID_CALLBACK_URL|evil\.example\.com|one-time-code/iu);
  });

  it("the app's own sign-in request keeps its JSON error", async () => {
    const response = normalizeMagicLinkVerifyResponse(appSignInRequest, jsonResponse(429, "TOO_MANY_REQUESTS"));

    expect(response.status).toBe(429);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({ code: "TOO_MANY_REQUESTS", message: "TOO_MANY_REQUESTS detail" });
  });

  it("a link that signs in still hands over to the app", () => {
    const signedIn = new Response(null, { status: 302, headers: { location: "bjjroll://auth/callback?code=one-time-code" } });

    const response = normalizeMagicLinkVerifyResponse(verifyRequest, signedIn);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("bjjroll://auth/callback?code=one-time-code");
  });
});

describe.skipIf(!isPostgresTestEnvironmentAvailable())("a browser that taps Continue too often gets the safe page (Sara, 1 Nov)", () => {
  let environment: StartedAuthTestEnvironment | undefined;

  beforeAll(async () => {
    environment = await startAuthTestEnvironment();
  }, 60_000);

  afterAll(async () => {
    await environment?.stop();
  }, 30_000);

  it("the rate-limited tap shows 'Something went wrong' as a page, not JSON", async () => {
    if (!environment) {
      throw new Error("Auth test environment not initialized");
    }
    const linkUrl = `${testBaseUrl}/api/auth/magic-link/verify?token=not-a-real-token`;
    const browserIp = "198.51.100.77";
    for (let count = 1; count <= MAX_VERIFIES_PER_IP_PER_WINDOW; count += 1) {
      const tap = await continueMagicLink(environment.app, linkUrl, { ipAddress: browserIp });
      expect(tap.status).not.toBe(429);
    }

    const limited = await continueMagicLink(environment.app, linkUrl, { ipAddress: browserIp });

    expect(limited.status).toBe(429);
    expect(limited.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const html = await limited.text();
    expect(html).toContain("<h1>Something went wrong</h1>");
    expect(html).not.toMatch(/"code"|TOO_MANY_REQUESTS|<script/iu);
  });
});
