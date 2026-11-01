import { MAGIC_LINK_REASON_PARAM, magicLinkReasons } from "@bjj-roll/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DEEP_LINK_CALLBACK_URL, MAGIC_LINK_EXPIRY_SECONDS } from "../auth/index.js";
import { normalizeMagicLinkVerifyResponse } from "../auth/authRequestGuards.js";
import {
  boundMagicLinkSend,
  continueMagicLink,
  currentSignUpAttestation,
  postAuthJson,
  startAuthTestEnvironment,
  type StartedAuthTestEnvironment,
} from "./authTestHelper.js";
import { isPostgresTestEnvironmentAvailable } from "./databaseTestHarness.js";

const verifyUrl = "http://localhost:3000/api/auth/magic-link/verify?token=sample-token&callbackURL=bjjroll%3A%2F%2Fauth%2Fcallback";
const reasonLocation = (reason: string): string => `${DEEP_LINK_CALLBACK_URL}?${MAGIC_LINK_REASON_PARAM}=${reason}`;
const linkInvalidLocation = reasonLocation(magicLinkReasons.linkInvalid);

function expectAppHandoverIsRedirect(response: Response): void {
  const location = response.headers.get("location") ?? "";
  expect(location.startsWith("bjjroll://")).toBe(true);
  expect(response.status).toBeGreaterThanOrEqual(300);
  expect(response.status).toBeLessThan(400);
}

async function expectBodylessRedirect(response: Response, status: number, location = linkInvalidLocation): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get("location")).toBe(location);
  expect(response.headers.get("content-type")).toBeNull();
  expect(await response.text()).toBe("");
}

describe("an expired or used sign-in link sends the browser back to the app with no body (Vera 1)", () => {
  const failed = (code: string): Response =>
    new Response(JSON.stringify({ code }), {
      status: 302,
      headers: { location: `bjjroll://auth/callback?error=${code}`, "content-type": "application/json" },
    });

  it.each(["EXPIRED_TOKEN", "INVALID_TOKEN"])("%s on a GET answers 302 and on the Continue POST answers 303", async (code) => {
    const request = new Request(verifyUrl);

    await expectBodylessRedirect(normalizeMagicLinkVerifyResponse(request, failed(code)), 302);
    await expectBodylessRedirect(normalizeMagicLinkVerifyResponse(request, failed(code), "POST"), 303);
  });

  it.each([
    ["AGE_CONFIRMATION_REQUIRED", magicLinkReasons.ageRefused],
    ["SIGN_UP_ATTESTATION_REQUIRED", magicLinkReasons.attestationRefused],
  ])("%s keeps its own reason, never link_invalid (Sara)", async (code, reason) => {
    const request = new Request(verifyUrl);

    await expectBodylessRedirect(normalizeMagicLinkVerifyResponse(request, failed(code)), 302, reasonLocation(reason));
    await expectBodylessRedirect(normalizeMagicLinkVerifyResponse(request, failed(code), "POST"), 303, reasonLocation(reason));
  });

  it.each(
    [200, 302, 307, 400].flatMap((status) =>
      ["code=one-time-code", "error=EXPIRED_TOKEN", "error=AGE_CONFIRMATION_REQUIRED", "error=SIGN_UP_ATTESTATION_REQUIRED"].map((query) => ({
        status,
        query,
      })),
    ),
  )("Better Auth $status with $query still hands over by a bodyless 302 on GET and 303 on POST", async ({ status, query }) => {
    const answer = (): Response =>
      new Response("{}", { status, headers: { location: `bjjroll://auth/callback?${query}`, "content-type": "application/json" } });

    for (const [method, expected] of [
      ["GET", 302],
      ["POST", 303],
    ] as const) {
      const response = normalizeMagicLinkVerifyResponse(new Request(verifyUrl), answer(), method);
      expectAppHandoverIsRedirect(response);
      expect(response.status).toBe(expected);
      expect(await response.text()).toBe("");
    }
  });
});

describe.skipIf(!isPostgresTestEnvironmentAvailable())("every verify answer that hands over to the app is a redirect (Vera 1)", () => {
  let environment: StartedAuthTestEnvironment | undefined;

  const current = (): StartedAuthTestEnvironment => {
    if (!environment) {
      throw new Error("Auth test environment not initialized");
    }
    return environment;
  };

  const sendLink = async (
    email: string,
    ipAddress: string,
    answers: object = { age16Confirmed: true, ...currentSignUpAttestation },
  ): Promise<string> => {
    const response = await postAuthJson(current().app, "/sign-in/magic-link", {
      body: { email, ...answers, ...boundMagicLinkSend },
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

  beforeAll(async () => {
    environment = await startAuthTestEnvironment();
  }, 60_000);

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    await environment?.stop();
  }, 30_000);

  it("expired link: 303, empty body, link-invalid Location", async () => {
    const ipAddress = "198.51.100.231";
    const startMs = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(startMs);
    const link = await sendLink("expired.redirect@example.com", ipAddress);
    vi.setSystemTime(startMs + MAGIC_LINK_EXPIRY_SECONDS * 1000 + 1000);

    const expired = await continueMagicLink(current().app, link, { ipAddress });

    expectAppHandoverIsRedirect(expired);
    await expectBodylessRedirect(expired, 303);
  });

  it("success then used link: both hand over by a bodyless 303 after the Continue tap", async () => {
    const ipAddress = "198.51.100.232";
    const link = await sendLink("used.redirect@example.com", ipAddress);

    const signedIn = await continueMagicLink(current().app, link, { ipAddress });
    const used = await continueMagicLink(current().app, link, { ipAddress });

    expectAppHandoverIsRedirect(signedIn);
    expect(signedIn.status).toBe(303);
    expect(await signedIn.text()).toBe("");
    expect(new URL(signedIn.headers.get("location") ?? "").searchParams.get("code")).not.toBeNull();
    expectAppHandoverIsRedirect(used);
    await expectBodylessRedirect(used, 303);
  });

  it.each([
    { name: "age refused", answers: { ...currentSignUpAttestation }, reason: magicLinkReasons.ageRefused, ipAddress: "198.51.100.233" },
    { name: "attestation refused", answers: { age16Confirmed: true }, reason: magicLinkReasons.attestationRefused, ipAddress: "198.51.100.234" },
  ])("$name link: 303, empty body, its own reason in the Location", async ({ name, answers, reason, ipAddress }) => {
    const link = await sendLink(`${name.replace(" ", ".")}.redirect@example.com`, ipAddress, answers);

    const refused = await continueMagicLink(current().app, link, { ipAddress });

    expectAppHandoverIsRedirect(refused);
    await expectBodylessRedirect(refused, 303, reasonLocation(reason));
  });
});
