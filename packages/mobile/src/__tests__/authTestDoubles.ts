import { SIGN_UP_ATTESTATION_TEXT_VERSION } from "@bjj-roll/shared";
import { vi } from "vitest";

export const TEST_BACKEND_URL = "http://backend.test";
export const TEST_SESSION_COOKIE = "better-auth.session_token=signed-session-value; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800";

export interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly cookie: string | null;
  readonly body: Record<string, unknown> | null;
}

export function createMemorySecureStore() {
  const items = new Map<string, string>();
  const failingKeys = new Set<string>();
  const failIfBroken = (key: string) => (failingKeys.has(key) ? Promise.reject(new Error("SecureStore write failed")) : null);
  return {
    items,
    failingKeys,
    getItem: (key: string) => items.get(key) ?? null,
    getItemAsync: (key: string) => Promise.resolve(items.get(key) ?? null),
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
    setItemAsync: (key: string, value: string) => {
      const broken = failIfBroken(key);
      if (broken) {
        return broken;
      }
      items.set(key, value);
      return Promise.resolve();
    },
    deleteItemAsync: vi.fn((key: string) => {
      const broken = failIfBroken(key);
      if (broken) {
        return broken;
      }
      items.delete(key);
      return Promise.resolve();
    }),
  };
}

function jsonResponse(body: unknown, headers: Record<string, string> = {}, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

export const TEST_DELETE_CODE = "654321";

export const TEST_ACCOUNT_EXPORT = {
  exportedAt: "2026-10-25T08:00:00.000Z",
  user: {
    id: "01964c3a-7f00-7000-8000-000000000001",
    email: "member@example.test",
    handle: "roller_1",
    createdAt: "2026-10-01T08:00:00.000Z",
    linkedProviders: [],
  },
  consentRecords: [
    {
      id: "01964c3a-7f00-7000-8000-000000000002",
      userId: "01964c3a-7f00-7000-8000-000000000001",
      textVersionId: "age-confirmation-v1",
      acceptedAt: "2026-10-01T08:00:00.000Z",
      withdrawnAt: null,
      consentType: "age_confirmation",
      age16Confirmed: true,
      age18Confirmed: false,
    },
  ],
} as const;

export const TEST_PROVIDER_AUTHORIZATION_URL = "https://provider.example.test/authorize?state=fake-state";

export interface FakeBackendOptions {
  readonly nativeSignInRefusal?: { status: number; body: unknown };
  readonly emailOtpRefusal?: { status: number; body: unknown };
  readonly signUpAttestationAcceptedVersion?: string | null;
  readonly signUpAttestationBadPayload?: boolean;
}

export function createFakeBackend(options: FakeBackendOptions = {}) {
  const requests: RecordedRequest[] = [];
  let adultConfirmed = false;
  let acceptedAttestation =
    options.signUpAttestationAcceptedVersion === undefined ? SIGN_UP_ATTESTATION_TEXT_VERSION.id : options.signUpAttestationAcceptedVersion;
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
    if (pathname.endsWith("/sign-in/social")) {
      const body = requests.at(-1)?.body;
      if (body?.idToken !== undefined) {
        if (options.nativeSignInRefusal) {
          return jsonResponse(options.nativeSignInRefusal.body, {}, options.nativeSignInRefusal.status);
        }
        return jsonResponse({ redirect: false, token: "raw-session-token", user: { id: "user-1" } }, { "set-cookie": TEST_SESSION_COOKIE });
      }
      return jsonResponse({ url: `${TEST_PROVIDER_AUTHORIZATION_URL}&provider=${String(body?.provider)}`, redirect: false });
    }
    if (pathname.endsWith("/sign-in/email-otp") && options.emailOtpRefusal) {
      return jsonResponse(options.emailOtpRefusal.body, {}, options.emailOtpRefusal.status);
    }
    if (pathname.endsWith("/sign-in/email-otp") || pathname.endsWith("/magic-link/exchange")) {
      return jsonResponse({ token: "raw-session-token", user: { id: "user-1" } }, { "set-cookie": TEST_SESSION_COOKIE });
    }
    const signedIn = request.headers.get("cookie")?.includes("better-auth.session_token=signed-session-value") ?? false;
    if (pathname.endsWith("/get-session")) {
      return jsonResponse(signedIn ? { user: { id: "user-1" }, session: { id: "session-1", expiresAt: "2099-01-01T00:00:00.000Z" } } : null);
    }
    if (
      pathname === "/account/export" ||
      pathname === "/account" ||
      pathname === "/account/delete-code" ||
      pathname === "/account/age-confirmation" ||
      pathname === "/account/signup-attestation"
    ) {
      if (!signedIn) {
        return jsonResponse({ error: "Authentication required" }, {}, 401);
      }
      if (pathname === "/account/signup-attestation") {
        if (request.method === "POST") {
          if (requests.at(-1)?.body?.textVersionId !== SIGN_UP_ATTESTATION_TEXT_VERSION.id) {
            return jsonResponse({ error: "Invalid request" }, {}, 400);
          }
          acceptedAttestation = SIGN_UP_ATTESTATION_TEXT_VERSION.id;
        }
        if (options.signUpAttestationBadPayload === true) {
          return jsonResponse({ required: "maybe" });
        }
        const current = SIGN_UP_ATTESTATION_TEXT_VERSION.id;
        return jsonResponse({ required: acceptedAttestation !== current, currentTextVersionId: current, acceptedTextVersionId: acceptedAttestation });
      }
      if (pathname === "/account/age-confirmation") {
        if (request.method === "POST") {
          if (requests.at(-1)?.body?.age18Confirmed !== true) {
            return jsonResponse({ error: "Invalid request" }, {}, 400);
          }
          adultConfirmed = true;
        }
        return jsonResponse({ age16Confirmed: true, age18Confirmed: adultConfirmed, canPurchase: adultConfirmed });
      }
      if (pathname === "/account/delete-code") {
        return jsonResponse({ sent: true });
      }
      if (pathname === "/account") {
        const codeMatches = requests.at(-1)?.body?.code === TEST_DELETE_CODE;
        return codeMatches ? jsonResponse({ deleted: true }) : jsonResponse({ error: "Invalid or expired code" }, {}, 403);
      }
      return jsonResponse(TEST_ACCOUNT_EXPORT);
    }
    return jsonResponse({ status: true });
  };
  return { requests, fetchImplementation: vi.fn(fetchImplementation) };
}
