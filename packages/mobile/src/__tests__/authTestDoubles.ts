import { vi } from "vitest";

export const TEST_BACKEND_URL = "http://backend.test";
export const TEST_SESSION_COOKIE = "better-auth.session_token=signed-session-value; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800";

export interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly cookie: string | null;
  readonly body: Record<string, unknown> | null;
}

/** In-memory stand-in for expo-secure-store with the methods the Expo client and sign-out use. */
export function createMemorySecureStore() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    getItemAsync: (key: string) => Promise.resolve(items.get(key) ?? null),
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
    setItemAsync: (key: string, value: string) => {
      items.set(key, value);
      return Promise.resolve();
    },
    deleteItemAsync: vi.fn((key: string) => {
      items.delete(key);
      return Promise.resolve();
    }),
  };
}

function jsonResponse(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });
}

/** Fake backend: sign-in endpoints set a session cookie; get-session answers only when that cookie is sent. */
export function createFakeBackend() {
  const requests: RecordedRequest[] = [];
  const fetchImplementation = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const bodyText = request.method === "GET" ? "" : await request.text();
    const pathname = new URL(request.url).pathname;
    requests.push({
      url: request.url,
      method: request.method,
      cookie: request.headers.get("cookie"),
      body: bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : null,
    });
    if (pathname.endsWith("/sign-in/email-otp") || pathname.endsWith("/magic-link/exchange")) {
      return jsonResponse({ token: "raw-session-token", user: { id: "user-1" } }, { "set-cookie": TEST_SESSION_COOKIE });
    }
    if (pathname.endsWith("/get-session")) {
      const signedIn = request.headers.get("cookie")?.includes("better-auth.session_token=signed-session-value") ?? false;
      return jsonResponse(signedIn ? { user: { id: "user-1" }, session: { id: "session-1", expiresAt: "2099-01-01T00:00:00.000Z" } } : null);
    }
    return jsonResponse({ status: true });
  };
  return { requests, fetchImplementation: vi.fn(fetchImplementation) };
}
