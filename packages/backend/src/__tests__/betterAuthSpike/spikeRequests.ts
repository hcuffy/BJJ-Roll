import type { Hono } from "hono";
import { spikeBaseUrl } from "./spikeAuth.js";

export function postJson(app: Hono, path: string, request: { body: Record<string, unknown>; ipAddress: string }): Promise<Response> {
  return Promise.resolve(
    app.request(`${spikeBaseUrl}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: spikeBaseUrl, "x-forwarded-for": request.ipAddress },
      body: JSON.stringify(request.body),
    }),
  );
}

export function getWithCookie(app: Hono, url: string, request: { cookie?: string; ipAddress: string }): Promise<Response> {
  const headers: Record<string, string> = { "x-forwarded-for": request.ipAddress };
  if (request.cookie) {
    headers.cookie = request.cookie;
  }
  return Promise.resolve(app.request(url, { headers }));
}

export function sessionCookieFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0] ?? "")
    .filter((cookie) => cookie.includes("session_token"))
    .join("; ");
}
