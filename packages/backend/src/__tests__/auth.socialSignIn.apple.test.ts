import { randomUUID } from "node:crypto";
import { AGE_GATE_REFUSAL_MESSAGE } from "@bjj-roll/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { APPLE_REFRESH_TOKEN_ENVELOPE_PREFIX, APPLE_REVOKE_ENDPOINT, APPLE_TOKEN_ENDPOINT, openAppleRefreshToken } from "../auth/index.js";
import { createAccountTestFlow, type SignedInUser } from "./accountTestFlow.js";
import { isPostgresTestEnvironmentAvailable } from "./databaseTestHarness.js";
import {
  dumpRawAuthTables,
  extractSessionCookie,
  postAuthJson,
  startAuthTestEnvironment,
  type StartedAuthTestEnvironment,
} from "./authTestHelper.js";
import { createFakeAppleIdentityTokenSigner, createFakeSocialProviderConfig, stubProviderFetch } from "./socialSignInTestDoubles.js";

const socialProviders = createFakeSocialProviderConfig();
const apple =
  socialProviders.apple ??
  (() => {
    throw new Error("fake Apple config missing");
  })();
const signer = createFakeAppleIdentityTokenSigner();

describe.skipIf(!isPostgresTestEnvironmentAvailable())("HEN-239 Sign in with Apple (native iOS identity token)", () => {
  let environment: StartedAuthTestEnvironment | undefined;
  let providerFetch: ReturnType<typeof stubProviderFetch> | undefined;
  let revokeStatus = 200;
  let issuedRefreshToken: string | undefined;
  const capturedLogs: string[] = [];
  const authEvents: { event: string; userId: string }[] = [];

  const current = (): StartedAuthTestEnvironment => {
    if (!environment) {
      throw new Error("Auth test environment not initialized");
    }
    return environment;
  };
  const flow = createAccountTestFlow(current);

  const countRows = async (table: "users" | "sessions" | "accounts"): Promise<number> => {
    const result = await current().pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM public.${table}`);
    return result.rows[0]?.count ?? 0;
  };

  const identityToken = (subject: string, email: string): string =>
    signer.signIdentityToken({
      iss: "https://appleid.apple.com",
      aud: apple.appBundleIdentifier,
      sub: subject,
      email,
      email_verified: "true",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 600,
    });

  interface AppleSignInAttempt {
    readonly subject: string;
    readonly email: string;
    readonly additionalData: Record<string, unknown> | undefined;
    readonly ipAddress: string;
  }

  const signInWithApple = ({ subject, email, additionalData, ipAddress }: AppleSignInAttempt): Promise<Response> =>
    postAuthJson(current().app, "/sign-in/social", {
      body: { provider: "apple", idToken: { token: identityToken(subject, email) }, additionalData },
      ipAddress,
    });

  const signUpWithApple = async (email: string, ipAddress: string): Promise<SignedInUser> => {
    const response = await signInWithApple({
      subject: `apple-sub-${randomUUID()}`,
      email,
      additionalData: { ageConfirmed: true, appleAuthorizationCode: "fake-apple-code" },
      ipAddress,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { user: { id: string } };
    return { email, cookie: extractSessionCookie(response), userId: body.user.id, ipAddress };
  };

  const storedAppleRefreshToken = async (userId: string): Promise<string | null> => {
    const result = await current().pool.query<{ refresh_token: string | null }>(
      "SELECT refresh_token FROM public.accounts WHERE user_id = $1 AND provider_id = 'apple'",
      [userId],
    );
    return result.rows[0]?.refresh_token ?? null;
  };

  beforeAll(async () => {
    const recordLog = (...entries: unknown[]): void => {
      capturedLogs.push(entries.map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry))).join(" "));
    };
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation(recordLog);
    }
    providerFetch = stubProviderFetch((url) => {
      if (url === "https://appleid.apple.com/auth/keys") {
        return Response.json(signer.jwks);
      }
      if (url === APPLE_TOKEN_ENDPOINT) {
        issuedRefreshToken = `fake-apple-refresh-${randomUUID()}`;
        return Response.json({ access_token: "fake-apple-access", refresh_token: issuedRefreshToken, token_type: "Bearer", expires_in: 3600 });
      }
      if (url === APPLE_REVOKE_ENDPOINT) {
        return new Response(null, { status: revokeStatus });
      }
      return undefined;
    });
    environment = await startAuthTestEnvironment({
      logger: { disabled: false, level: "debug" },
      socialProviders,
      logAuthEvent: (event, userId) => authEvents.push({ event, userId }),
    });
  }, 60_000);

  beforeEach(() => {
    revokeStatus = 200;
    providerFetch?.requests.splice(0);
  });

  afterAll(async () => {
    providerFetch?.restore();
    vi.restoreAllMocks();
    await environment?.stop();
  }, 30_000);

  it("creates an account from a verified identity token and keeps only a sealed Apple refresh token", async () => {
    const usersBefore = await countRows("users");
    const user = await signUpWithApple("new.apple.member@example.com", "198.51.100.210");

    expect(user.cookie).toContain("=");
    expect(await countRows("users")).toBe(usersBefore + 1);
    const exchange = providerFetch?.requests.find((request) => request.url === APPLE_TOKEN_ENDPOINT);
    expect(exchange?.body.get("client_id")).toBe(apple.appBundleIdentifier);
    expect(exchange?.body.get("grant_type")).toBe("authorization_code");

    const stored = await storedAppleRefreshToken(user.userId);
    expect(stored?.startsWith(APPLE_REFRESH_TOKEN_ENVELOPE_PREFIX)).toBe(true);
    expect(stored).not.toContain(issuedRefreshToken);
    expect(openAppleRefreshToken(current().codec, stored ?? "")).toEqual({ refreshToken: issuedRefreshToken, clientId: apple.appBundleIdentifier });
    const rawDump = await dumpRawAuthTables(current().pool);
    expect(rawDump).not.toContain(issuedRefreshToken);
    expect(rawDump).not.toContain("fake-apple-access");
  });

  it.each([
    { name: "no age answer", additionalData: undefined },
    { name: "ageConfirmed false", additionalData: { ageConfirmed: false } },
  ])("refuses a new Apple account with $name and leaves no user or session", async ({ additionalData }) => {
    const before = { users: await countRows("users"), sessions: await countRows("sessions") };
    const response = await signInWithApple({
      subject: "apple-sub-refused",
      email: "refused.apple.member@example.com",
      additionalData,
      ipAddress: "198.51.100.211",
    });

    expect(response.status).toBe(400);
    expect(((await response.json()) as { message?: string }).message).toBe(AGE_GATE_REFUSAL_MESSAGE);
    expect(extractSessionCookie(response)).toBe("");
    expect({ users: await countRows("users"), sessions: await countRows("sessions") }).toEqual(before);
  });

  it("rejects an identity token not signed by Apple's key", async () => {
    const unsignedPart = identityToken("apple-sub-forged", "forged.apple@example.com").split(".").slice(0, 2).join(".");
    const forged = `${unsignedPart}.${Buffer.from("forged").toString("base64url")}`;
    const usersBefore = await countRows("users");
    const response = await postAuthJson(current().app, "/sign-in/social", {
      body: { provider: "apple", idToken: { token: forged }, additionalData: { ageConfirmed: true } },
      ipAddress: "198.51.100.212",
    });
    expect(response.status).toBe(401);
    expect(await countRows("users")).toBe(usersBefore);
  });

  it("still signs in when Apple gives no refresh token, logging only the user id", async () => {
    const user = await (async () => {
      const response = await signInWithApple({
        subject: "apple-sub-no-code",
        email: "no.code.apple@example.com",
        additionalData: { ageConfirmed: true },
        ipAddress: "198.51.100.213",
      });
      expect(response.status).toBe(200);
      return ((await response.json()) as { user: { id: string } }).user.id;
    })();
    expect(await storedAppleRefreshToken(user)).toBeNull();
    expect(authEvents).toContainEqual({ event: "apple_refresh_token_missing", userId: user });
  });

  it("revokes the Apple token with Apple before deleting the account", async () => {
    const user = await signUpWithApple("delete.apple.member@example.com", "198.51.100.214");
    const refreshToken = issuedRefreshToken;

    const response = await flow.deleteAccount(user);

    expect(response.status).toBe(200);
    const revoke = providerFetch?.requests.find((request) => request.url === APPLE_REVOKE_ENDPOINT);
    expect(revoke?.body.get("token")).toBe(refreshToken);
    expect(revoke?.body.get("token_type_hint")).toBe("refresh_token");
    expect(revoke?.body.get("client_id")).toBe(apple.appBundleIdentifier);
    const remaining = await current().pool.query<{ count: number }>("SELECT count(*)::int AS count FROM public.users WHERE id = $1", [user.userId]);
    expect(remaining.rows[0]?.count).toBe(0);
  });

  it("still deletes the account when Apple refuses the revoke, logging only the user id", async () => {
    const user = await signUpWithApple("revoke.fails.apple@example.com", "198.51.100.215");
    const refreshToken = issuedRefreshToken ?? "";
    revokeStatus = 400;
    const lines: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      lines.push(String(chunk).trimEnd());
      return true;
    });
    const logsBefore = capturedLogs.length;
    let status: number;
    try {
      status = (await flow.deleteAccount(user)).status;
    } finally {
      stdoutSpy.mockRestore();
    }

    expect(status).toBe(200);
    const failureLines = lines.filter((line) => line.includes("account_apple_revoke_failed"));
    expect(failureLines.map((line) => JSON.parse(line) as unknown)).toEqual([{ event: "account_apple_revoke_failed", userId: user.userId }]);
    const remaining = await current().pool.query<{ count: number }>("SELECT count(*)::int AS count FROM public.users WHERE id = $1", [user.userId]);
    expect(remaining.rows[0]?.count).toBe(0);
    const allLogs = [...lines, ...capturedLogs.slice(logsBefore)].join("\n");
    expect(allLogs).not.toContain(refreshToken);
    expect(allLogs).not.toContain(user.email);
  });

  it("lists Apple in the account export", async () => {
    const user = await signUpWithApple("export.apple.member@example.com", "198.51.100.216");
    const response = await flow.accountRequest("GET", "/account/export", { cookie: user.cookie, ipAddress: user.ipAddress });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { user: { linkedProviders: string[] } };
    expect(body.user.linkedProviders).toEqual(["apple"]);
  });

  it("never logs a token or email", () => {
    const allLogs = capturedLogs.join("\n");
    expect(allLogs).not.toContain("fake-apple-refresh-");
    expect(allLogs).not.toContain("fake-apple-access");
    expect(allLogs).not.toContain("new.apple.member@example.com");
    expect(allLogs.toLowerCase()).not.toContain("ageconfirmed");
  });
});
