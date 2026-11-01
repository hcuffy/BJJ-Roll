import { describe, expect, it } from "vitest";
import { prepareMagicLinkRequest } from "../auth/authRequestGuards.js";
import { magicLinkContinuePage } from "../auth/magicLinkContinuePage.js";

const verifyUrl = "http://localhost:3000/api/auth/magic-link/verify?token=sample-token";
const tamperedUrl = `${verifyUrl}&callbackURL=${encodeURIComponent("https://evil.example.com")}`;

async function tamperedLinkPage(method: "GET" | "POST"): Promise<Response> {
  const prepared = await prepareMagicLinkRequest(new Request(tamperedUrl, { method }));
  if (!(prepared instanceof Response)) {
    throw new Error("A tampered link must be answered, not passed on");
  }
  return prepared;
}

function expectLockedDownPage(response: Response): void {
  expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
  expect(response.headers.get("content-security-policy")).toBe(
    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
  );
  expect(response.headers.get("x-frame-options")).toBe("DENY");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
}

describe("the browser pages for a sign-in link are locked down and never show raw JSON (Bill nit 1, Vera fix 8)", () => {
  it("the Continue page forbids scripts and framing and runs no script of its own", async () => {
    const response = magicLinkContinuePage();
    expectLockedDownPage(response);
    const html = await response.text();
    expect(html).not.toMatch(/<script|\son[a-z]+=|javascript:/iu);
  });

  it.each(["GET", "POST"] as const)("a %s on a tampered link shows the dark 'This link doesn't work' page, not JSON", async (method) => {
    const response = await tamperedLinkPage(method);
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
    expectLockedDownPage(response);
    const html = await response.text();
    expect(html).toContain("<title>This BJJ Roll sign-in link doesn't work</title>");
    expect(html).toContain("<h1>This link doesn't work</h1>");
    expect(html).toContain("<p>Open BJJ Roll and send a new sign-in link.</p>");
    expect(html).toContain('<meta name="color-scheme" content="dark">');
    expect(html).toMatch(/body \{[^}]*background: #111313;[^}]*color: #FFFFFF;/u);
    expect(html).not.toMatch(/<script|<form|<button|INVALID_CALLBACK_URL|evil\.example\.com|"code"/iu);
  });
});
