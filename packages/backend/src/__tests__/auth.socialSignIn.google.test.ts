import { AGE_CONFIRMATION_TEXT_VERSION_ID, AGE_GATE_REFUSAL_MESSAGE } from "@bjj-roll/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DEEP_LINK_CALLBACK_URL } from "../auth/index.js";
import { isPostgresTestEnvironmentAvailable } from "./databaseTestHarness.js";
import {
  dumpRawAuthTables,
  extractSessionCookie,
  getAuthPath,
  postAuthJson,
  startAuthTestEnvironment,
  type StartedAuthTestEnvironment,
} from "./authTestHelper.js";
import { cookieHeaderFrom, createFakeSocialProviderConfig, fakeGoogleConfig, stubProviderFetch, unsignedIdToken } from "./socialSignInTestDoubles.js";

interface FakeGoogleUser {
  subject: string;
  email: string;
  emailVerified: boolean;
}

const fakeAccessToken = "fake-google-access-token-never-stored";
const fakeIdTokenMarker = "fake-google-id-token-marker";

describe.skipIf(!isPostgresTestEnvironmentAvailable())("HEN-239 Google sign-in (browser flow, code exchange back to the app)", () => {
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

  it("creates an account for a new Google user who ticked the 16+ box, returning only a one-time code to the app", async () => {
    const usersBefore = await countRows("users");
    const { location, callbackResponse } = await signInWithGoogle(
      { subject: "google-sub-new", email: "new.google.member@example.com", emailVerified: true },
      { additionalData: { age16Confirmed: true, age18Confirmed: true } },
    );

    expect(location.href.startsWith(`${DEEP_LINK_CALLBACK_URL}?`)).toBe(true);
    expect([...location.searchParams.keys()]).toEqual(["code"]);
    expect(callbackResponse.headers.getSetCookie().some((cookie) => cookie.includes("session_token=") && !cookie.includes("Max-Age=0"))).toBe(false);

    const { userId, cookie } = await exchangeForSession(location.searchParams.get("code") ?? "");
    expect(cookie).toContain("=");
    expect(await countRows("users")).toBe(usersBefore + 1);
    const accounts = await current().pool.query<{
      provider_id: string;
      access_token: string | null;
      id_token: string | null;
      refresh_token: string | null;
    }>("SELECT provider_id, access_token, id_token, refresh_token FROM public.accounts WHERE user_id = $1", [userId]);
    expect(accounts.rows).toEqual([{ provider_id: "google", access_token: null, id_token: null, refresh_token: null }]);
    // HEN-263: the same consent record as an email sign-up, with the 18+ answer sent by the app.
    const consent = await current().pool.query(
      "SELECT consent_type, text_version_id, age16_confirmed, age18_confirmed FROM public.consent_records WHERE user_id = $1",
      [userId],
    );
    expect(consent.rows).toEqual([
      { consent_type: "age_confirmation", text_version_id: AGE_CONFIRMATION_TEXT_VERSION_ID, age16_confirmed: true, age18_confirmed: true },
    ]);
  });

  it.each([
    { name: "no age answer", additionalData: undefined },
    { name: "16+ unticked but 18+ ticked", additionalData: { age16Confirmed: false, age18Confirmed: true } },
    { name: "16+ as a string", additionalData: { age16Confirmed: "true" } },
    { name: "only the old ageConfirmed field", additionalData: { ageConfirmed: true } },
  ])("refuses a new Google account with $name: error back to the app, no user or session", async ({ additionalData }) => {
    const before = { users: await countRows("users"), sessions: await countRows("sessions"), accounts: await countRows("accounts") };
    const { location } = await signInWithGoogle(
      { subject: "google-sub-refused", email: "refused.google.member@example.com", emailVerified: true },
      { additionalData },
    );

    expect(location.href.startsWith(`${DEEP_LINK_CALLBACK_URL}?`)).toBe(true);
    expect(location.searchParams.get("error")).toBe("AGE_CONFIRMATION_REQUIRED");
    expect(location.searchParams.get("code")).toBeNull();
    expect(location.searchParams.get("error_description")).toBe(AGE_GATE_REFUSAL_MESSAGE);
    expect({ users: await countRows("users"), sessions: await countRows("sessions"), accounts: await countRows("accounts") }).toEqual(before);
  });

  it("signs a returning Google user in again without asking the age question", async () => {
    const googleUser = { subject: "google-sub-returning", email: "returning.google.member@example.com", emailVerified: true };
    const first = await signInWithGoogle(googleUser, { additionalData: { age16Confirmed: true, age18Confirmed: false } });
    const { userId } = await exchangeForSession(first.location.searchParams.get("code") ?? "");

    const again = await signInWithGoogle(googleUser, {});
    expect(again.location.searchParams.get("error")).toBeNull();
    expect((await exchangeForSession(again.location.searchParams.get("code") ?? "")).userId).toBe(userId);
  });

  it("links Google to an existing email account when Google has verified the same address", async () => {
    const email = "email.first.member@example.com";
    const sendResponse = await postAuthJson(current().app, "/email-otp/send-verification-otp", {
      body: { email, type: "sign-in", age16Confirmed: true },
      ipAddress: "198.51.100.202",
    });
    expect(sendResponse.status).toBe(200);
    const sent = current()
      .emailSender.sentMessages.filter((message) => message.kind === "one_time_code")
      .at(-1);
    const otp = sent?.kind === "one_time_code" ? sent.code : "";
    const signInResponse = await postAuthJson(current().app, "/sign-in/email-otp", { body: { email, otp }, ipAddress: "198.51.100.202" });
    const emailUserId = ((await signInResponse.json()) as { user: { id: string } }).user.id;
    const usersBefore = await countRows("users");

    const { location } = await signInWithGoogle({ subject: "google-sub-linked", email: email.toUpperCase(), emailVerified: true }, {});
    expect((await exchangeForSession(location.searchParams.get("code") ?? "")).userId).toBe(emailUserId);
    expect(await countRows("users")).toBe(usersBefore);
    const providers = await current().pool.query<{ provider_id: string }>(
      "SELECT provider_id FROM public.accounts WHERE user_id = $1 ORDER BY provider_id",
      [emailUserId],
    );
    expect(providers.rows.map((row) => row.provider_id)).toContain("google");
  });

  it("does not link or create an account when Google has not verified an address that already has an account", async () => {
    const email = "unverified.clash@example.com";
    const first = await signInWithGoogle(
      { subject: "google-sub-owner", email, emailVerified: true },
      { additionalData: { age16Confirmed: true, age18Confirmed: false } },
    );
    const { userId: ownerId } = await exchangeForSession(first.location.searchParams.get("code") ?? "");
    const before = { users: await countRows("users"), accounts: await countRows("accounts") };

    const { location } = await signInWithGoogle(
      { subject: "google-sub-intruder", email, emailVerified: false },
      { additionalData: { age16Confirmed: true, age18Confirmed: false } },
    );
    expect(location.searchParams.get("code")).toBeNull();
    expect(location.searchParams.get("error")).toBe("account_not_linked");
    expect({ users: await countRows("users"), accounts: await countRows("accounts") }).toEqual(before);
    const owned = await current().pool.query<{ count: number }>("SELECT count(*)::int AS count FROM public.accounts WHERE user_id = $1", [ownerId]);
    expect(owned.rows[0]?.count).toBe(1);
  });

  it("rejects a sign-in redirect that is not a bjjroll:// deep link", async () => {
    const response = await postAuthJson(current().app, "/sign-in/social", {
      body: {
        provider: "google",
        callbackURL: "https://evil.example.com/steal",
        disableRedirect: true,
        additionalData: { age16Confirmed: true, age18Confirmed: false },
      },
      ipAddress: "198.51.100.203",
    });
    expect(response.status).toBe(400);
  });

  it("rate limits sign-in starts per IP", async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const response = await postAuthJson(current().app, "/sign-in/social", {
        body: { provider: "google", callbackURL: DEEP_LINK_CALLBACK_URL, disableRedirect: true },
        ipAddress: "198.51.100.204",
      });
      statuses.push(response.status);
    }
    expect(statuses).toContain(429);
  });

  it("never stores or logs the provider tokens, the age answer or the email", async () => {
    const rawDump = await dumpRawAuthTables(current().pool);
    expect(rawDump).not.toContain(fakeAccessToken);
    expect(rawDump).not.toContain(fakeIdTokenMarker);
    expect(rawDump.toLowerCase()).not.toContain("ageconfirmed");
    expect(rawDump).not.toContain("new.google.member@example.com");
    const allLogs = capturedLogs.join("\n");
    expect(allLogs).not.toContain(fakeAccessToken);
    expect(allLogs.toLowerCase()).not.toContain("ageconfirmed");
    expect(allLogs).not.toContain("new.google.member@example.com");
    expect(allLogs).not.toContain("refused.google.member@example.com");
  });
});
