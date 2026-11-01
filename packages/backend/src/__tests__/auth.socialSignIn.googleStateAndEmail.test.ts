import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEEP_LINK_CALLBACK_URL } from "../auth/index.js";
import { isPostgresTestEnvironmentAvailable } from "./databaseTestHarness.js";
import {
  getAuthPath,
  postAuthJson,
  startAuthTestEnvironment,
  type StartedAuthTestEnvironment,
  currentSignUpAttestation,
  testSignInVerifier,
  testSignInVerifierHash,
} from "./authTestHelper.js";
import { cookieHeaderFrom, createFakeSocialProviderConfig, fakeGoogleConfig, stubProviderFetch, unsignedIdToken } from "./socialSignInTestDoubles.js";

interface FakeGoogleUser {
  readonly subject: string;
  readonly email: string;
  readonly emailVerified: boolean | undefined;
}

interface StartedGoogleSignIn {
  readonly authorizationUrl: URL;
  readonly cookie: string;
  readonly ipAddress: string;
}

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
let nextIp = 10;

describe.skipIf(!isPostgresTestEnvironmentAvailable())("HEN-239 Google browser flow: PKCE, state and email_verified", () => {
  let environment: StartedAuthTestEnvironment | undefined;
  let nextGoogleUser: FakeGoogleUser | undefined;
  let providerFetch: ReturnType<typeof stubProviderFetch> | undefined;

  const current = (): StartedAuthTestEnvironment => {
    if (!environment) {
      throw new Error("Auth test environment not initialized");
    }
    return environment;
  };

  const countRows = async (): Promise<Record<"users" | "sessions" | "accounts", number>> => {
    const result = await current().pool.query<{ users: number; sessions: number; accounts: number }>(
      "SELECT (SELECT count(*)::int FROM public.users) AS users, (SELECT count(*)::int FROM public.sessions) AS sessions, " +
        "(SELECT count(*)::int FROM public.accounts) AS accounts",
    );
    const row = result.rows[0];
    return { users: row?.users ?? -1, sessions: row?.sessions ?? -1, accounts: row?.accounts ?? -1 };
  };

  const startGoogleSignIn = async (age16Confirmed: boolean): Promise<StartedGoogleSignIn> => {
    nextIp += 1;
    const ipAddress = `198.51.100.${nextIp}`;
    const response = await postAuthJson(current().app, "/sign-in/social", {
      body: {
        provider: "google",
        callbackURL: DEEP_LINK_CALLBACK_URL,
        errorCallbackURL: DEEP_LINK_CALLBACK_URL,
        disableRedirect: true,
        additionalData: age16Confirmed
          ? { verifierHash: testSignInVerifierHash, age16Confirmed: true, ...currentSignUpAttestation, age18Confirmed: false }
          : { verifierHash: testSignInVerifierHash },
      },
      ipAddress,
    });
    expect(response.status).toBe(200);
    const { url } = (await response.json()) as { url: string };
    return { authorizationUrl: new URL(url), cookie: cookieHeaderFrom(response), ipAddress };
  };

  const googleRedirectBack = async (started: StartedGoogleSignIn, query: string, cookie = started.cookie): Promise<URL> => {
    const response = await getAuthPath(current().app, `/callback/google?${query}`, { ipAddress: started.ipAddress, cookie });
    expect(response.status).toBe(302);
    return new URL(response.headers.get("location") ?? "");
  };

  const stateQuery = (started: StartedGoogleSignIn): string =>
    `code=fake-google-code&state=${encodeURIComponent(started.authorizationUrl.searchParams.get("state") ?? "")}`;

  const signInWithGoogle = async (googleUser: FakeGoogleUser, age16Confirmed = true): Promise<URL> => {
    const started = await startGoogleSignIn(age16Confirmed);
    nextGoogleUser = googleUser;
    return await googleRedirectBack(started, stateQuery(started));
  };

  const googleRefusal = async (googleUser: FakeGoogleUser): Promise<{ status: number; location: string | null; body: string }> => {
    const started = await startGoogleSignIn(true);
    nextGoogleUser = googleUser;
    const response = await getAuthPath(current().app, `/callback/google?${stateQuery(started)}`, {
      ipAddress: started.ipAddress,
      cookie: started.cookie,
    });
    return { status: response.status, location: response.headers.get("location"), body: await response.text() };
  };

  const exchangeForUserId = async (code: string): Promise<string> => {
    const response = await postAuthJson(current().app, "/magic-link/exchange", {
      body: { code, verifier: testSignInVerifier },
      ipAddress: "198.51.100.9",
    });
    expect(response.status).toBe(200);
    return ((await response.json()) as { user: { id: string } }).user.id;
  };

  const tokenRequests = () => providerFetch?.requests.filter((request) => request.url === GOOGLE_TOKEN_ENDPOINT) ?? [];

  beforeAll(async () => {
    providerFetch = stubProviderFetch((url) => {
      if (url !== GOOGLE_TOKEN_ENDPOINT || !nextGoogleUser) {
        return undefined;
      }
      const now = Math.floor(Date.now() / 1000);
      const idToken = unsignedIdToken({
        iss: "https://accounts.google.com",
        aud: fakeGoogleConfig.clientId,
        sub: nextGoogleUser.subject,
        email: nextGoogleUser.email,
        ...(nextGoogleUser.emailVerified === undefined ? {} : { email_verified: nextGoogleUser.emailVerified }),
        iat: now,
        exp: now + 600,
      });
      return Response.json({ access_token: "fake-google-access", id_token: idToken, token_type: "Bearer", expires_in: 3600, scope: "openid email" });
    });
    environment = await startAuthTestEnvironment({ socialProviders: createFakeSocialProviderConfig() });
  }, 60_000);

  beforeEach(() => {
    providerFetch?.requests.splice(0);
    nextGoogleUser = undefined;
  });

  afterAll(async () => {
    providerFetch?.restore();
    await environment?.stop();
  }, 30_000);

  it("sends Google a fresh state and an S256 PKCE challenge, then proves the matching code_verifier at the token exchange", async () => {
    const first = await startGoogleSignIn(true);
    const second = await startGoogleSignIn(true);
    const state = first.authorizationUrl.searchParams.get("state") ?? "";
    const challenge = first.authorizationUrl.searchParams.get("code_challenge") ?? "";

    expect(first.authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(state.length).toBeGreaterThanOrEqual(32);
    expect(challenge).toMatch(/^[\w-]{43}$/u);
    expect(second.authorizationUrl.searchParams.get("state")).not.toBe(state);
    expect(second.authorizationUrl.searchParams.get("code_challenge")).not.toBe(challenge);

    nextGoogleUser = { subject: "google-sub-pkce", email: "pkce.google.member@example.com", emailVerified: true };
    const location = await googleRedirectBack(first, stateQuery(first));
    expect(location.searchParams.get("code")).not.toBeNull();
    const verifier = tokenRequests()[0]?.body.get("code_verifier") ?? "";
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(challenge);
  });

  it.each([
    { name: "a wrong state", query: () => "code=fake-google-code&state=tampered-state-value", withCookie: true },
    { name: "no state", query: () => "code=fake-google-code", withCookie: true },
    { name: "another sign-in's state", query: "other", withCookie: true },
    { name: "the right state but no state cookie (another browser)", query: "own", withCookie: false },
  ] as const)("refuses Google's redirect with $name: no code exchange, no user, no session", async ({ query, withCookie }) => {
    const started = await startGoogleSignIn(true);
    const other = await startGoogleSignIn(true);
    const before = await countRows();
    nextGoogleUser = { subject: "google-sub-state", email: "state.google.member@example.com", emailVerified: true };
    const queries = { own: stateQuery(started), other: stateQuery(other) };

    const location = await googleRedirectBack(started, typeof query === "function" ? query() : queries[query], withCookie ? started.cookie : "");

    expect(location.searchParams.get("code")).toBeNull();
    expect(location.searchParams.get("error")).not.toBeNull();
    expect(tokenRequests()).toEqual([]);
    expect(await countRows()).toEqual(before);
  });

  it.each([
    { name: "no email_verified claim", emailVerified: undefined },
    { name: "email_verified false", emailVerified: false },
  ])(
    "refuses a new Google account with $name, with the same status, redirect and body as when the email has an account",
    async ({ emailVerified }) => {
      const takenEmail = `taken.${String(emailVerified)}.google@example.com`;
      const ownerCode = (
        await signInWithGoogle({ subject: `google-sub-owner-${String(emailVerified)}`, email: takenEmail, emailVerified: true })
      ).searchParams.get("code");
      const ownerId = await exchangeForUserId(ownerCode ?? "");
      const before = await countRows();

      const freshEmail = await googleRefusal({
        subject: `google-sub-new-${String(emailVerified)}`,
        email: `fresh.${String(emailVerified)}.google@example.com`,
        emailVerified,
      });
      const takenEmailAttempt = await googleRefusal({ subject: `google-sub-intruder-${String(emailVerified)}`, email: takenEmail, emailVerified });

      expect(freshEmail.status).toBe(302);
      expectAccountNotLinked(new URL(freshEmail.location ?? ""));
      expect(takenEmailAttempt).toEqual(freshEmail);
      expect(await countRows()).toEqual(before);
      const owned = await current().pool.query<{ account_id: string }>("SELECT account_id FROM public.accounts WHERE user_id = $1", [ownerId]);
      expect(owned.rows.map((row) => row.account_id)).toEqual([`google-sub-owner-${String(emailVerified)}`]);
    },
  );

  it("refuses a returning Google user whose id token suddenly has no email_verified claim", async () => {
    const googleUser = { subject: "google-sub-claim-returning", email: "returning.claim.google@example.com", emailVerified: true };
    await exchangeForUserId((await signInWithGoogle(googleUser)).searchParams.get("code") ?? "");
    const before = await countRows();

    const location = await signInWithGoogle({ ...googleUser, emailVerified: undefined }, false);

    expectAccountNotLinked(location);
    expect(await countRows()).toEqual(before);
  });
});

function expectAccountNotLinked(location: URL): void {
  expect(`${location.protocol}//${location.host}${location.pathname}`).toBe(DEEP_LINK_CALLBACK_URL);
  expect(location.searchParams.get("error")).toBe("account_not_linked");
  expect(location.searchParams.has("error_description")).toBe(false);
}
