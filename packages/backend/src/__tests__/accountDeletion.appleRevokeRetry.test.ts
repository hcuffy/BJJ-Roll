import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { APPLE_REVOKE_ENDPOINT, sealAppleRefreshToken } from "../auth/appleTokens.js";
import { createAccountTestFlow, type SignedInUser } from "./accountTestFlow.js";
import { isPostgresTestEnvironmentAvailable } from "./databaseTestHarness.js";
import { startAuthTestEnvironment, type StartedAuthTestEnvironment } from "./authTestHelper.js";
import { createFakeSocialProviderConfig, stubProviderFetch } from "./socialSignInTestDoubles.js";

describe.skipIf(!isPostgresTestEnvironmentAvailable())("B9 account deletion queues a retry when Apple does not take the revoke", () => {
  let environment: StartedAuthTestEnvironment | undefined;
  let providerFetch: ReturnType<typeof stubProviderFetch> | undefined;
  let revokeStatus = 200;
  let enqueueFails = false;
  const queued: string[] = [];
  const lines: string[] = [];

  const current = (): StartedAuthTestEnvironment => {
    if (!environment) {
      throw new Error("Auth test environment not initialized");
    }
    return environment;
  };
  const flow = createAccountTestFlow(current);

  const signInWithAppleLink = async (email: string, ipAddress: string, refreshToken: string | null): Promise<SignedInUser> => {
    const user = await flow.signIn(email, ipAddress);
    const sealed = refreshToken === null ? null : sealAppleRefreshToken(current().codec, { refreshToken, clientId: null });
    await current().pool.query(
      "INSERT INTO public.accounts (id, user_id, account_id, provider_id, refresh_token, created_at, updated_at)" +
        " VALUES ($1, $2, $3, 'apple', $4, now(), now())",
      [randomUUID(), user.userId, `apple-sub-${randomUUID()}`, sealed],
    );
    return user;
  };

  const userCount = async (userId: string): Promise<number> => {
    const result = await current().pool.query<{ count: number }>("SELECT count(*)::int AS count FROM public.users WHERE id = $1", [userId]);
    return result.rows[0]?.count ?? -1;
  };

  const loggedEvents = (): unknown[] => lines.filter((line) => line.startsWith("{")).map((line) => JSON.parse(line) as unknown);

  beforeAll(async () => {
    providerFetch = stubProviderFetch((url) => (url === APPLE_REVOKE_ENDPOINT ? new Response(null, { status: revokeStatus }) : undefined));
    environment = await startAuthTestEnvironment({
      socialProviders: createFakeSocialProviderConfig(),
      appleRevokeRetries: {
        enqueue: (sealedRefreshToken) => {
          if (enqueueFails) {
            return Promise.reject(new Error("queue down"));
          }
          queued.push(sealedRefreshToken);
          return Promise.resolve();
        },
      },
    });
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      lines.push(String(chunk).trimEnd());
      return true;
    });
  }, 60_000);

  beforeEach(() => {
    revokeStatus = 200;
    enqueueFails = false;
    queued.splice(0);
    lines.splice(0);
    providerFetch?.requests.splice(0);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    providerFetch?.restore();
    await environment?.stop();
  }, 30_000);

  it("Apple refuses: the account is deleted and the sealed token is queued for a retry, with no token in the logs", async () => {
    const refreshToken = `apple-refresh-${randomUUID()}`;
    const user = await signInWithAppleLink("revoke.retry@example.com", "198.51.100.161", refreshToken);
    revokeStatus = 503;

    const response = await flow.deleteAccount(user);

    expect(response.status).toBe(200);
    expect(await userCount(user.userId)).toBe(0);
    expect(queued).toHaveLength(1);
    expect(queued[0]).not.toContain(refreshToken);
    expect(loggedEvents()).toContainEqual({ event: "account_apple_revoke_failed", userId: user.userId });
    expect(loggedEvents()).toContainEqual({ event: "account_apple_revoke_queued", userId: user.userId });
    expect(lines.join("\n")).not.toContain(refreshToken);
    expect(lines.join("\n")).not.toContain(queued[0]);
  });

  it("Apple accepts: nothing is queued", async () => {
    const user = await signInWithAppleLink("revoke.ok@example.com", "198.51.100.162", `apple-refresh-${randomUUID()}`);

    const response = await flow.deleteAccount(user);

    expect(response.status).toBe(200);
    expect(providerFetch?.requests.filter((request) => request.url === APPLE_REVOKE_ENDPOINT)).toHaveLength(1);
    expect(queued).toEqual([]);
  });

  it("no Apple token was ever stored: deletion goes ahead, logged as skipped, not as a failure", async () => {
    const user = await signInWithAppleLink("revoke.notoken@example.com", "198.51.100.163", null);

    const response = await flow.deleteAccount(user);

    expect(response.status).toBe(200);
    expect(await userCount(user.userId)).toBe(0);
    expect(queued).toEqual([]);
    expect(providerFetch?.requests.filter((request) => request.url === APPLE_REVOKE_ENDPOINT)).toEqual([]);
    expect(loggedEvents()).toContainEqual({ event: "account_apple_revoke_skipped", userId: user.userId, reason: "no_refresh_token" });
    expect(loggedEvents()).not.toContainEqual({ event: "account_apple_revoke_failed", userId: user.userId });
  });

  it("Apple refuses and the retry queue is down: deletion still goes ahead", async () => {
    const user = await signInWithAppleLink("revoke.queuedown@example.com", "198.51.100.164", `apple-refresh-${randomUUID()}`);
    revokeStatus = 503;
    enqueueFails = true;

    const response = await flow.deleteAccount(user);

    expect(response.status).toBe(200);
    expect(await userCount(user.userId)).toBe(0);
    expect(loggedEvents()).toContainEqual({ event: "account_apple_revoke_not_queued", userId: user.userId });
  });
});
