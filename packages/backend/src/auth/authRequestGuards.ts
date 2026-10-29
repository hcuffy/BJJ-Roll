import { isIP } from "node:net";
import {
  AGE_GATE_REFUSAL_MESSAGE,
  MAGIC_LINK_REASON_PARAM,
  MAGIC_LINK_REASONS,
  SIGN_UP_ATTESTATION_REFUSAL_MESSAGE,
  type MagicLinkReason,
} from "@bjj-roll/shared";
import { APIError } from "better-auth/api";
import { DEEP_LINK_CALLBACK_URL } from "./authLimits.js";
import { findInvalidRedirectParameters, isAllowedDeepLinkCallbackUrl } from "./deepLinkCallback.js";

/** Proxy headers that may carry the client IP. Ignored unless listed in `trustedProxyIpHeaders`. */
export const TRUSTABLE_PROXY_IP_HEADERS = ["cf-connecting-ip", "x-real-ip", "x-forwarded-for"] as const;
export type TrustableProxyIpHeader = (typeof TRUSTABLE_PROXY_IP_HEADERS)[number];

/** Internal header carrying the resolved client IP to Better Auth's rate limiter. Always overwritten. */
export const CLIENT_IP_HEADER = "x-bjj-client-ip";
/** Shared rate-limit bucket when no client IP is known (fails closed: all such clients share one budget). */
const UNKNOWN_CLIENT_IP = "0.0.0.0";
export const AUTH_BASE_PATH = "/api/auth";
const MAGIC_LINK_VERIFY_PATH = `${AUTH_BASE_PATH}/magic-link/verify`;
const MAGIC_LINK_SIGN_IN_PATH = `${AUTH_BASE_PATH}/sign-in/magic-link`;

function normalizeIpAddress(candidate: string | undefined | null): string | null {
  if (!candidate) {
    return null;
  }
  const trimmed = candidate.trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/u, "");
  return isIP(trimmed) === 0 ? null : trimmed;
}

/**
 * Client IP for rate limiting. Proxy headers count only when explicitly trusted; for x-forwarded-for the
 * right-most entry (added by the trusted proxy) is used. Otherwise the socket address, else a shared bucket.
 */
export function resolveClientIpAddress(
  headers: Headers,
  remoteAddress: string | undefined,
  trustedProxyIpHeaders: readonly TrustableProxyIpHeader[],
): string {
  for (const headerName of TRUSTABLE_PROXY_IP_HEADERS) {
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

/** Validates magic-link redirect parameters before Better Auth sees them; adds the default deep link when absent. */
export async function prepareMagicLinkRequest(request: Request): Promise<Request | Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === MAGIC_LINK_VERIFY_PATH) {
    const invalid = findInvalidRedirectParameters((name) => url.searchParams.get(name) ?? undefined);
    if (invalid.length > 0) {
      return invalidCallbackResponse(invalid);
    }
    if (!url.searchParams.has("callbackURL")) {
      url.searchParams.set("callbackURL", DEEP_LINK_CALLBACK_URL);
      return new Request(url.toString(), request);
    }
    return request;
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

/** Strips cookies/tokens from the magic-link redirect and never lets a non-deep-link Location out. */
function magicLinkVerifyErrorMessage(errorCode: string): string {
  // HEN-263: a new account refused at link time for a missing 16+ tick says so (HEN-183: the same for a missing attestation);
  // every other failure keeps the generic text.
  if (errorCode === "AGE_CONFIRMATION_REQUIRED") {
    return AGE_GATE_REFUSAL_MESSAGE;
  }
  if (errorCode === "SIGN_UP_ATTESTATION_REQUIRED") {
    return SIGN_UP_ATTESTATION_REFUSAL_MESSAGE;
  }
  return "Magic link token is invalid, expired, or has already been used";
}

function magicLinkReason(errorCode: string): MagicLinkReason {
  if (errorCode === "AGE_CONFIRMATION_REQUIRED") {
    return MAGIC_LINK_REASONS.ageRefused;
  }
  return errorCode === "SIGN_UP_ATTESTATION_REQUIRED" ? MAGIC_LINK_REASONS.attestationRefused : MAGIC_LINK_REASONS.linkInvalid;
}

function reasonOnlyLocation(redirectUrl: URL, reason: MagicLinkReason): string {
  const reasonUrl = new URL(redirectUrl.toString());
  reasonUrl.search = "";
  reasonUrl.hash = "";
  reasonUrl.searchParams.set(MAGIC_LINK_REASON_PARAM, reason);
  return reasonUrl.toString();
}

export function normalizeMagicLinkVerifyResponse(request: Request, response: Response): Response {
  if (new URL(request.url).pathname !== MAGIC_LINK_VERIFY_PATH) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.delete("set-cookie");
  const location = headers.get("location");
  if (location === null) {
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
  if (!isAllowedDeepLinkCallbackUrl(location)) {
    return invalidCallbackResponse(["Location"]);
  }
  const redirectUrl = new URL(location);
  redirectUrl.searchParams.delete("cookie");
  redirectUrl.searchParams.delete("token");
  redirectUrl.searchParams.delete("session");
  headers.set("location", redirectUrl.toString());
  const errorCode = redirectUrl.searchParams.get("error");
  if (errorCode !== null) {
    // Sara, 26 Oct: the deep link carries a fixed reason code only, never Better Auth's code or error_description text.
    headers.set("location", reasonOnlyLocation(redirectUrl, magicLinkReason(errorCode)));
    headers.set("content-type", "application/json");
    return new Response(JSON.stringify({ code: errorCode, error: errorCode, message: magicLinkVerifyErrorMessage(errorCode) }), {
      status: 400,
      headers,
    });
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** Better Auth before-hook check (defense in depth: the handler already rejected these). */
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
