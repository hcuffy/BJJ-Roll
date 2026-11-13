import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MAGIC_LINK_EXCHANGE_CODE_EXPIRY_SECONDS } from "../auth/index.js";
import { isPostgresTestEnvironmentAvailable } from "./databaseTestHarness.js";
import {
  boundMagicLinkSend,
  continueMagicLink,
  currentSignUpAttestation,
  extractSessionCookie,
  getAuthPath,
  postAuthJson,
  startAuthTestEnvironment,
  testSignInVerifier,
  type StartedAuthTestEnvironment,
} from "./authTestHelper.js";

describe.skipIf(!isPostgresTestEnvironmentAvailable())("magic link Continue page and verifier-bound exchange", () => {
  let environment: StartedAuthTestEnvironment | undefined;

  const current = (): StartedAuthTestEnvironment => {
    if (!environment) {
      throw new Error("Auth test environment not initialized");
    }
    return environment;
  };

  const sendBoundLink = async (email: string, ipAddress: string, send: Record<string, unknown> = boundMagicLinkSend): Promise<string> => {
    const response = await postAuthJson(current().app, "/sign-in/magic-link", {
      body: { email, age16Confirmed: true, ...currentSignUpAttestation, ...send },
      ipAddress,
    });
    expect(response.status).toBe(200);
    const sent = current()
      .emailSender.sentMessages.filter((message) => message.kind === "magic_link" && message.to === email)
      .at(-1);
    if (!sent || sent.kind !== "magic_link") {
      throw new Error(`No magic link sent for ${email}`);
    }
    return sent.url;
  };

  const exchangeCodeFrom = async (magicLinkUrl: string, ipAddress: string): Promise<string> => {
    const response = await continueMagicLink(current().app, magicLinkUrl, { ipAddress });
    expect(response.status).toBe(303);
    return new URL(response.headers.get("location") ?? "").searchParams.get("code") ?? "";
  };

  const exchange = (code: string, ipAddress: string, verifier?: string): Promise<Response> =>
    postAuthJson(current().app, "/magic-link/exchange", { body: verifier === undefined ? { code } : { code, verifier }, ipAddress });

  beforeAll(async () => {
    environment = await startAuthTestEnvironment();
  }, 60_000);

  afterAll(async () => {
    await environment?.stop();
  }, 30_000);

  it("GET /magic-link/verify shows a Continue page that posts back, and does not spend the link", async () => {
    const magicLinkUrl = await sendBoundLink("continue.page@example.com", "198.51.103.1");

    const page = await getAuthPath(current().app, magicLinkUrl, { ipAddress: "198.51.103.1" });
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(page.headers.get("set-cookie")).toBeNull();
    expect(page.headers.get("location")).toBeNull();
    const html = await page.text();
    expect(html).toContain("Continue signing in to BJJ Roll");
    expect(html).toContain('<form method="post">');
    expect(html).toContain('<button type="submit">Continue</button>');

    const secondPage = await getAuthPath(current().app, magicLinkUrl, { ipAddress: "198.51.103.1" });
    expect(secondPage.status).toBe(200);

    const code = await exchangeCodeFrom(magicLinkUrl, "198.51.103.1");
    expect(code.length).toBeGreaterThan(16);
    const replay = await continueMagicLink(current().app, magicLinkUrl, { ipAddress: "198.51.103.1" });
    expect(replay.headers.get("location") ?? "").not.toContain("code=");
  });

  it("an exchange without the verifier, or with the wrong one, returns 401 and leaves the code unspent", async () => {
    const ipAddress = "198.51.103.2";
    const code = await exchangeCodeFrom(await sendBoundLink("verifier.bound@example.com", ipAddress), ipAddress);

    const missing = await exchange(code, ipAddress);
    expect(missing.status).toBe(401);
    expect(extractSessionCookie(missing)).toBe("");
    const wrong = await exchange(code, ipAddress, `${testSignInVerifier.slice(0, -1)}0`);
    expect(wrong.status).toBe(401);
    expect(extractSessionCookie(wrong)).toBe("");

    const right = await exchange(code, ipAddress, testSignInVerifier);
    expect(right.status).toBe(200);
    expect(((await right.json()) as { user: { email: string } }).user.email).toBe("verifier.bound@example.com");
    expect(extractSessionCookie(right)).toContain("=");

    const replay = await exchange(code, ipAddress, testSignInVerifier);
    expect(replay.status).toBe(401);
  });

  it("D27 a code kept by a wrong verifier still expires 60 s after it was issued", async () => {
    const ipAddress = "198.51.103.3";
    const code = await exchangeCodeFrom(await sendBoundLink("verifier.expiry@example.com", ipAddress), ipAddress);
    expect((await exchange(code, ipAddress, "not-the-verifier")).status).toBe(401);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + MAGIC_LINK_EXCHANGE_CODE_EXPIRY_SECONDS * 1000 + 1000);
      expect((await exchange(code, ipAddress, testSignInVerifier)).status).toBe(401);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a link sent without a verifier hash never exchanges for a session", async () => {
    const ipAddress = "198.51.103.4";
    const code = await exchangeCodeFrom(await sendBoundLink("verifier.unbound@example.com", ipAddress, {}), ipAddress);
    expect(code.length).toBeGreaterThan(16);
    expect((await exchange(code, ipAddress, testSignInVerifier)).status).toBe(401);
  });
});
