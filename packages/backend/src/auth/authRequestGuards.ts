import { isIP } from "node:net";
import { MAGIC_LINK_REASON_PARAM, magicLinkReasons, type MagicLinkReason } from "@bjj-roll/shared";
import { APIError } from "better-auth/api";
import { DEEP_LINK_CALLBACK_URL } from "./authLimits.js";
import { findInvalidRedirectParameters, isAllowedDeepLinkCallbackUrl } from "./deepLinkCallback.js";
import { magicLinkContinuePage, magicLinkInvalidPage, magicLinkTroublePage } from "./magicLinkContinuePage.js";

export const trustableProxyIpHeaders = ["cf-connecting-ip", "x-real-ip", "x-forwarded-for"] as const;
export type TrustableProxyIpHeader = (typeof trustableProxyIpHeaders)[number];

export const CLIENT_IP_HEADER = "x-bjj-client-ip";
const UNKNOWN_CLIENT_IP = "0.0.0.0";
export const AUTH_BASE_PATH = "/api/auth";
export const MAGIC_LINK_VERIFY_PATH = `${AUTH_BASE_PATH}/magic-link/verify`;
const MAGIC_LINK_SIGN_IN_PATH = `${AUTH_BASE_PATH}/sign-in/magic-link`;

function normalizeIpAddress(candidate: string | undefined | null): string | null {
  if (!candidate) {
    return null;
  }
  const trimmed = candidate.trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/u, "");
  return isIP(trimmed) === 0 ? null : trimmed;
}

export function resolveClientIpAddress(
  headers: Headers,
  remoteAddress: string | undefined,
  trustedProxyIpHeaders: readonly TrustableProxyIpHeader[],
): string {
  for (const headerName of trustableProxyIpHeaders) {
    if (!trustedProxyIpHeaders.includes(headerName)) {
      continue;
    }
    const headerValue = headers.get(headerName);
    if (headerValue === null) {
      continue;
    }
    const entries = headerValue.split(",");
    const proxied = normalizeIpAddress(entries.at(-1));
    if (proxied !== null) {
      return proxied;
    }
  }
  return normalizeIpAddress(remoteAddress) ?? UNKNOWN_CLIENT_IP;
}

function jsonErrorResponse(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ code, error: code, message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function invalidCallbackResponse(parameterNames: readonly string[]): Response {
  return jsonErrorResponse(400, "INVALID_CALLBACK_URL", `${parameterNames.join(", ")} must be a ${DEEP_LINK_CALLBACK_URL} deep link in M2`);
}

function verifyRequestFromContinuePost(url: URL, request: Request): Request {
  const headers = new Headers(request.headers);
  headers.delete("content-type");
  headers.delete("content-length");
  return new Request(url.toString(), { method: "GET", headers });
}

export async function prepareMagicLinkRequest(request: Request): Promise<Request | Response> {
  const url = new URL(request.url);
  if ((request.method === "GET" || request.method === "POST") && url.pathname === MAGIC_LINK_VERIFY_PATH) {
    if (findInvalidRedirectParameters((name) => url.searchParams.get(name) ?? undefined).length > 0) {
      return magicLinkInvalidPage();
    }
    if (request.method === "GET") {
      return magicLinkContinuePage();
    }
    if (!url.searchParams.has("callbackURL")) {
      url.searchParams.set("callbackURL", DEEP_LINK_CALLBACK_URL);
    }
    return verifyRequestFromContinuePost(url, request);
  }
  if (request.method === "POST" && url.pathname === MAGIC_LINK_SIGN_IN_PATH) {
    let body: unknown;
    try {
      body = JSON.parse(await request.clone().text());
    } catch {
      return request;
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return request;
    }
    const bodyRecord = body as Record<string, unknown>;
    const invalid = findInvalidRedirectParameters((name) => bodyRecord[name]);
    if (invalid.length > 0) {
      return invalidCallbackResponse(invalid);
    }
    if (bodyRecord.callbackURL === undefined) {
      const headers = new Headers(request.headers);
      headers.delete("content-length");
      return new Request(request.url, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...bodyRecord, callbackURL: DEEP_LINK_CALLBACK_URL }),
      });
    }
  }
  return request;
}

function magicLinkReason(errorCode: string): MagicLinkReason {
  if (errorCode === "AGE_CONFIRMATION_REQUIRED") {
    return magicLinkReasons.ageRefused;
  }
  return errorCode === "SIGN_UP_ATTESTATION_REQUIRED" ? magicLinkReasons.attestationRefused : magicLinkReasons.linkInvalid;
}

function reasonOnlyLocation(redirectUrl: URL, reason: MagicLinkReason): string {
  const reasonUrl = new URL(redirectUrl.toString());
  reasonUrl.search = "";
  reasonUrl.hash = "";
  reasonUrl.searchParams.set(MAGIC_LINK_REASON_PARAM, reason);
  return reasonUrl.toString();
}

export function normalizeMagicLinkVerifyResponse(request: Request, response: Response, requestMethod = request.method): Response {
  if (new URL(request.url).pathname !== MAGIC_LINK_VERIFY_PATH) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.delete("set-cookie");
  const location = headers.get("location");
  if (location === null && (response.status === 429 || response.status >= 500)) {
    return magicLinkTroublePage(response.status);
  }
  if (location === null) {
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
  if (!isAllowedDeepLinkCallbackUrl(location)) {
    return magicLinkInvalidPage();
  }
  const redirectUrl = new URL(location);
  redirectUrl.searchParams.delete("cookie");
  redirectUrl.searchParams.delete("token");
  redirectUrl.searchParams.delete("session");
  headers.set("location", redirectUrl.toString());
  const errorCode = redirectUrl.searchParams.get("error");
  if (errorCode !== null) {
    headers.set("location", reasonOnlyLocation(redirectUrl, magicLinkReason(errorCode)));
    headers.delete("content-type");
    headers.delete("content-length");
    return new Response(null, { status: requestMethod === "POST" ? 303 : 302, headers });
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function assertMagicLinkRedirectParameters(path: string, body: unknown, query: unknown): void {
  const sourceByPath: Record<string, unknown> = { "/sign-in/magic-link": body, "/magic-link/verify": query, "/sign-in/social": body };
  const source = sourceByPath[path];
  if (typeof source !== "object" || source === null) {
    return;
  }
  const record = source as Record<string, unknown>;
  if (findInvalidRedirectParameters((name) => record[name]).length > 0) {
    throw new APIError("BAD_REQUEST", {
      code: "INVALID_CALLBACK_URL",
      message: "Sign-in redirect URLs must be bjjroll:// deep links in M2",
    });
  }
}
