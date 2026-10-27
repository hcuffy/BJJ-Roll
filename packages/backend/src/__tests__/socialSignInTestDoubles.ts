import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { vi } from "vitest";
import type { AppleProviderConfig, SocialProviderConfig } from "../auth/index.js";

// Fake provider config and endpoints for HEN-239 tests. Every value here is made up for the test run; nothing is a real credential.

export const fakeGoogleConfig = { clientId: "test-google-client.apps.example.test", clientSecret: `test-google-${randomUUID()}` };

export function createFakeAppleConfig(): AppleProviderConfig {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return {
    serviceId: "test.bjjroll.signin",
    appBundleIdentifier: "test.bjjroll.app",
    teamId: "TESTTEAM01",
    keyId: "TESTKEY001",
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

export function createFakeSocialProviderConfig(): SocialProviderConfig {
  return { google: fakeGoogleConfig, apple: createFakeAppleConfig() };
}

const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64url");

/** A Google-style id token. The browser flow only decodes it (it came over TLS from the token endpoint), so it is unsigned here. */
export function unsignedIdToken(claims: Record<string, unknown>): string {
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(claims)}.`;
}

export interface FakeAppleIdentityTokenSigner {
  readonly jwks: { keys: Record<string, unknown>[] };
  readonly signIdentityToken: (claims: Record<string, unknown>) => string;
}

/** An RS256 key pair standing in for Apple's identity token key; its public half is served as the fake JWKS. */
export function createFakeAppleIdentityTokenSigner(): FakeAppleIdentityTokenSigner {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = "test-apple-kid";
  const jwk = publicKey.export({ format: "jwk" }) as Record<string, unknown>;
  return {
    jwks: { keys: [{ ...jwk, kid, alg: "RS256", use: "sig" }] },
    signIdentityToken: (claims) => {
      const signingInput = `${encode({ alg: "RS256", kid, typ: "JWT" })}.${encode(claims)}`;
      return `${signingInput}.${sign("sha256", Buffer.from(signingInput), privateKey).toString("base64url")}`;
    },
  };
}

export interface RecordedProviderRequest {
  readonly url: string;
  readonly body: URLSearchParams;
}

export type FakeProviderResponder = (url: string, body: URLSearchParams) => Response | undefined;

function requestUrlOf(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }
  return input instanceof URL ? input.toString() : input.url;
}

function formBodyOf(rawBody: RequestInit["body"]): string {
  if (typeof rawBody === "string") {
    return rawBody;
  }
  return rawBody instanceof URLSearchParams ? rawBody.toString() : "";
}

/** Stubs fetch for provider hosts only (oauth2.googleapis.com, appleid.apple.com); everything else goes to the real fetch. */
export function stubProviderFetch(responder: FakeProviderResponder): { requests: RecordedProviderRequest[]; restore: () => void } {
  const originalFetch = globalThis.fetch;
  const requests: RecordedProviderRequest[] = [];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = requestUrlOf(input);
    if (!/^https:\/\/(oauth2\.googleapis\.com|www\.googleapis\.com|appleid\.apple\.com)\//u.test(url)) {
      return originalFetch(input, init);
    }
    const body = new URLSearchParams(formBodyOf(init?.body));
    requests.push({ url, body });
    return Promise.resolve(responder(url, body) ?? new Response(JSON.stringify({ error: "unexpected_test_request" }), { status: 500 }));
  });
  return { requests, restore: () => spy.mockRestore() };
}

/** Name=value pairs from every set-cookie header, for replaying the browser's cookie jar. */
export function cookieHeaderFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0] ?? "")
    .filter((pair) => pair.includes("=") && !pair.endsWith("="))
    .join("; ");
}
