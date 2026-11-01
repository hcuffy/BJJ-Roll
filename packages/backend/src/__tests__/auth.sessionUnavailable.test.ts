import { createHmac } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { createAuth, generateTestAuthSecrets, loadAuthKeyringFromEnvironment } from "../auth/index.js";
import { createDatabase } from "../database/connection.js";
import { FakeEmailSender } from "../email/index.js";
import { createAccountTestFlow } from "./accountTestFlow.js";
import { getAuthPath, socketEnvironment, startAuthTestEnvironment, testBaseUrl, type StartedAuthTestEnvironment } from "./authTestHelper.js";
import { isPostgresTestEnvironmentAvailable } from "./databaseTestHarness.js";
import { InlineEmailQueue } from "./inlineEmailQueue.js";

const unavailablePool = {
  connect: () => Promise.reject(new Error("database unavailable")),
  query: () => Promise.reject(new Error("database unavailable")),
  on: () => undefined,
  end: () => Promise.resolve(),
} as unknown as Pool;

describe("B1 session lookup errors are not sign-outs", () => {
  const emailSender = new FakeEmailSender();
  const auth = createAuth({
    pool: unavailablePool,
    emailSender,
    emailQueue: new InlineEmailQueue(emailSender),
    keyring: loadAuthKeyringFromEnvironment(generateTestAuthSecrets()),
    baseURL: testBaseUrl,
  });
  const app = createApp({ auth, database: createDatabase(unavailablePool) });
  const signedSessionCookie = (token: string, secret: string) =>
    `better-auth.session_token=${encodeURIComponent(`${token}.${createHmac("sha256", secret).update(token).digest("base64")}`)}`;
  const exportWith = (cookie?: string) =>
    app.request(`${testBaseUrl}/account/export`, { headers: cookie ? { cookie } : {} }, socketEnvironment("198.51.100.241"));

  it("returns 503 unavailable on /account/export when the session store throws", async () => {
    const response = await exportWith(signedSessionCookie("session-token-under-test", auth.codec.deriveBetterAuthSecret()));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("still returns 401 for no cookie and for a cookie with a bad signature", async () => {
    expect((await exportWith()).status).toBe(401);
    expect((await exportWith(signedSessionCookie("session-token-under-test", "not-the-secret"))).status).toBe(401);
  });
});

describe.skipIf(!isPostgresTestEnvironmentAvailable())("B1 session lookup errors keep the user signed in", () => {
  let environment: StartedAuthTestEnvironment | undefined;

  const current = (): StartedAuthTestEnvironment => {
    if (!environment) {
      throw new Error("Auth test environment not initialized");
    }
    return environment;
  };

  beforeAll(async () => {
    environment = await startAuthTestEnvironment();
  }, 60_000);

  afterAll(async () => {
    await environment?.stop();
  }, 30_000);

  const { signIn, accountRequest } = createAccountTestFlow(current);

  const sessionRowCount = async (userId: string): Promise<number> => {
    const result = await current().pool.query<{ count: string }>("SELECT count(*) AS count FROM sessions WHERE user_id = $1", [userId]);
    return Number(result.rows[0]?.count ?? 0);
  };

  it("a database error gives 503 and the session still works afterwards", async () => {
    const user = await signIn("session.db.error@example.com", "198.51.100.150");
    const connectSpy = vi.spyOn(current().appLogin.pool, "connect").mockRejectedValue(new Error("database unavailable"));
    const unavailable = await accountRequest("GET", "/account/export", { cookie: user.cookie, ipAddress: user.ipAddress });
    connectSpy.mockRestore();
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ error: "unavailable" });
    expect(unavailable.headers.get("set-cookie")).toBeNull();
    expect(await sessionRowCount(user.userId)).toBe(1);
    const session = await getAuthPath(current().app, "/get-session", { cookie: user.cookie });
    expect(((await session.json()) as { user: { id: string } } | null)?.user.id).toBe(user.userId);
    expect((await accountRequest("GET", "/account/export", { cookie: user.cookie, ipAddress: user.ipAddress })).status).toBe(200);
  });

  it("a decrypt error gives 503 and does not delete the session", async () => {
    const user = await signIn("session.decrypt.error@example.com", "198.51.100.151");
    const original = await current().pool.query<{ email_ciphertext: string }>("SELECT email_ciphertext FROM users WHERE id = $1", [user.userId]);
    await current().pool.query("UPDATE users SET email_ciphertext = 'v1:not-a-valid-ciphertext' WHERE id = $1", [user.userId]);
    const unavailable = await accountRequest("GET", "/account/export", { cookie: user.cookie, ipAddress: user.ipAddress });
    await current().pool.query("UPDATE users SET email_ciphertext = $2 WHERE id = $1", [user.userId, original.rows[0]?.email_ciphertext]);
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ error: "unavailable" });
    expect(await sessionRowCount(user.userId)).toBe(1);
    expect((await accountRequest("GET", "/account/export", { cookie: user.cookie, ipAddress: user.ipAddress })).status).toBe(200);
  });
});
