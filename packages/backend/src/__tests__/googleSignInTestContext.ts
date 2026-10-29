import { afterAll, beforeAll, expect, vi } from "vitest";
import { DEEP_LINK_CALLBACK_URL } from "../auth/index.js";
import { extractSessionCookie, getAuthPath, postAuthJson, startAuthTestEnvironment, type StartedAuthTestEnvironment } from "./authTestHelper.js";
import { cookieHeaderFrom, createFakeSocialProviderConfig, fakeGoogleConfig, stubProviderFetch, unsignedIdToken } from "./socialSignInTestDoubles.js";

export interface FakeGoogleUser {
  subject: string;
  email: string;
  emailVerified: boolean;
}

export const fakeAccessToken = "fake-google-access-token-never-stored";
export const fakeIdTokenMarker = "fake-google-id-token-marker";

/** The HEN-239 Google browser flow against a fake Google: one auth environment per suite, started and stopped with it. */
export function createGoogleSignInTestContext() {
  let environment: StartedAuthTestEnvironment | undefined;
  let nextGoogleUser: FakeGoogleUser | undefined;
  let providerFetch: ReturnType<typeof stubProviderFetch> | undefined;
  const capturedLogs: string[] = [];

  const current = (): StartedAuthTestEnvironment => {
    if (!environment) {
      throw new Error("Auth test environment not initialized");
    }
    return environment;
  };

  const countRows = async (table: "users" | "sessions" | "accounts"): Promise<number> => {
    const result = await current().pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM public.${table}`);
    return result.rows[0]?.count ?? 0;
  };

  /** Starts sign-in as the app does (no redirect, URL handed to the in-app browser), then plays Google's redirect back. */
  const signInWithGoogle = async (
    googleUser: FakeGoogleUser,
    options: { additionalData?: Record<string, unknown>; ipAddress?: string },
  ): Promise<{ location: URL; callbackResponse: Response }> => {
    const ipAddress = options.ipAddress ?? "198.51.100.200";
    const startResponse = await postAuthJson(current().app, "/sign-in/social", {
      body: {
        provider: "google",
        callbackURL: DEEP_LINK_CALLBACK_URL,
        errorCallbackURL: DEEP_LINK_CALLBACK_URL,
        disableRedirect: true,
        additionalData: options.additionalData,
      },
      ipAddress,
    });
    expect(startResponse.status).toBe(200);
    const { url } = (await startResponse.json()) as { url: string };
    const authorizationUrl = new URL(url);
    expect(authorizationUrl.origin).toBe("https://accounts.google.com");
    expect(authorizationUrl.searchParams.get("client_id")).toBe(fakeGoogleConfig.clientId);
    nextGoogleUser = googleUser;
    const callbackResponse = await getAuthPath(
      current().app,
      `/callback/google?code=fake-google-code&state=${encodeURIComponent(authorizationUrl.searchParams.get("state") ?? "")}`,
      { ipAddress, cookie: cookieHeaderFrom(startResponse) },
    );
    expect(callbackResponse.status).toBe(302);
    return { location: new URL(callbackResponse.headers.get("location") ?? ""), callbackResponse };
  };

  const exchangeForSession = async (code: string): Promise<{ userId: string; cookie: string }> => {
    const exchangeResponse = await postAuthJson(current().app, "/magic-link/exchange", { body: { code }, ipAddress: "198.51.100.201" });
    expect(exchangeResponse.status).toBe(200);
    const payload = (await exchangeResponse.json()) as { user: { id: string } };
    return { userId: payload.user.id, cookie: extractSessionCookie(exchangeResponse) };
  };

  beforeAll(async () => {
    const recordLog = (...entries: unknown[]): void => {
      capturedLogs.push(entries.map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry))).join(" "));
    };
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation(recordLog);
    }
    providerFetch = stubProviderFetch((url) => {
      if (url !== "https://oauth2.googleapis.com/token" || !nextGoogleUser) {
        return undefined;
      }
      const idToken = unsignedIdToken({
        iss: "https://accounts.google.com",
        aud: fakeGoogleConfig.clientId,
        sub: nextGoogleUser.subject,
        email: nextGoogleUser.email,
        email_verified: nextGoogleUser.emailVerified,
        name: "Test Grappler",
        marker: fakeIdTokenMarker,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 600,
      });
      return Response.json({ access_token: fakeAccessToken, id_token: idToken, token_type: "Bearer", expires_in: 3600, scope: "openid email" });
    });
    environment = await startAuthTestEnvironment({ logger: { disabled: false, level: "debug" }, socialProviders: createFakeSocialProviderConfig() });
  }, 60_000);

  afterAll(async () => {
    providerFetch?.restore();
    vi.restoreAllMocks();
    await environment?.stop();
  }, 30_000);

  return { current, capturedLogs, countRows, signInWithGoogle, exchangeForSession };
}
