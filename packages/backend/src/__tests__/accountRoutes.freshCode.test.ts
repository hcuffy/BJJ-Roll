import { accountDeletionCodeResponseSchema } from "@bjj-roll/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_VERIFIES_PER_IP_PER_WINDOW, OTP_EXPIRY_SECONDS, OTP_MAX_ATTEMPTS, RATE_LIMIT_WINDOW_SECONDS } from "../auth/authLimits.js";
import { verificationIdentifiersForEmailHash } from "../database/cascadeDelete.js";
import { postAuthJson, startAuthTestEnvironment, type StartedAuthTestEnvironment } from "./authTestHelper.js";
import { createAccountTestFlow, type SignedInUser } from "./accountTestFlow.js";
import { isPostgresTestEnvironmentAvailable } from "./databaseTestHarness.js";

describe.skipIf(!isPostgresTestEnvironmentAvailable())("HEN-65 DELETE /account needs a fresh email code (Henry, 25 Oct)", () => {
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

  const { signIn, sendOtp, accountRequest, requestDeleteCode, latestCodeFor } = createAccountTestFlow(current);

  const accountState = async (user: SignedInUser) => {
    const { pool } = current();
    const users = await pool.query("SELECT id, email_hash, handle FROM public.users WHERE id = $1", [user.userId]);
    const sessions = await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM public.sessions WHERE user_id = $1", [user.userId]);
    const exportStatus = (await accountRequest("GET", "/account/export", { cookie: user.cookie })).status;
    return { users: users.rows, sessions: sessions.rows[0]?.count, exportStatus };
  };

  const deleteWith = (user: SignedInUser, body?: unknown) =>
    accountRequest("DELETE", "/account", { cookie: user.cookie, body, ipAddress: user.ipAddress });
  const tooManyAttempts = "Too many tries. Ask for a new code, or try again later.";
  const wrongCodeFor = (code: string): string => (code === "000000" ? "111111" : "000000");

  it("POST /account/delete-code needs a session, then emails a deletion code to the signed-in user's own address", async () => {
    expect((await accountRequest("POST", "/account/delete-code")).status).toBe(401);
    const user = await signIn("code.request@example.com", "198.51.100.120");
    const response = await accountRequest("POST", "/account/delete-code", { cookie: user.cookie, body: { email: "someone.else@example.com" } });
    expect(response.status).toBe(200);
    expect(accountDeletionCodeResponseSchema.parse(await response.json())).toEqual({ sent: true });
    const sent = current().emailSender.sentMessages.at(-1);
    expect(sent).toMatchObject({ kind: "one_time_code", to: "code.request@example.com", purpose: "account_deletion" });
    expect(current().emailSender.sentMessages.some((message) => message.to === "someone.else@example.com")).toBe(false);
  });

  it("refuses DELETE with no code, a malformed code, a wrong code, a sign-in code or another user's code, and touches nothing", async () => {
    const ipAddress = "198.51.100.121";
    const user = await signIn("refused.delete@example.com", ipAddress);
    const other = await signIn("other.member@example.com", ipAddress);
    const otherCode = await requestDeleteCode(other);
    const code = await requestDeleteCode(user);
    await sendOtp(user.email, ipAddress);
    const unusedSignInCode = latestCodeFor(user.email, "sign_in");
    const before = await accountState(user);
    expect(before).toMatchObject({ users: [{ id: user.userId }], sessions: 1, exportStatus: 200 });

    for (const body of [undefined, {}, { code: "" }, { code: "12345" }, { code: "abcdef" }]) {
      const response = await deleteWith(user, body);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "A 6-digit code is required" });
    }
    for (const candidate of [wrongCodeFor(code), unusedSignInCode, otherCode]) {
      const response = await deleteWith(user, { code: candidate });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Invalid or expired code" });
    }
    expect(await accountState(user)).toEqual(before);
    const signInWithIt = await postAuthJson(current().app, "/sign-in/email-otp", { body: { email: user.email, otp: unusedSignInCode }, ipAddress });
    expect(signInWithIt.status).toBe(200);
    expect((await deleteWith(user, { code })).status).toBe(200);
    expect(await accountState(other)).toMatchObject({ users: [{ id: other.userId }], exportStatus: 200 });
  });

  it("refuses a stale code: one past its expiry, and one superseded by a newer code", async () => {
    const ipAddress = "198.51.100.122";
    const expiredUser = await signIn("expired.code@example.com", ipAddress);
    const expiredCode = await requestDeleteCode(expiredUser);
    await current().pool.query("UPDATE public.verifications SET expires_at = now() - interval '1 second' WHERE identifier = ANY($1::text[])", [
      [...verificationIdentifiersForEmailHash(current().codec.computeEmailHmac(expiredUser.email))],
    ]);
    const expiredBefore = await accountState(expiredUser);
    expect((await deleteWith(expiredUser, { code: expiredCode })).status).toBe(403);
    expect(await accountState(expiredUser)).toEqual(expiredBefore);

    const supersededUser = await signIn("superseded.code@example.com", ipAddress);
    const firstCode = await requestDeleteCode(supersededUser);
    const secondCode = await requestDeleteCode(supersededUser);
    expect(secondCode).not.toBe(firstCode);
    const supersededBefore = await accountState(supersededUser);
    expect((await deleteWith(supersededUser, { code: firstCode })).status).toBe(403);
    expect(await accountState(supersededUser)).toEqual(supersededBefore);
    expect((await deleteWith(supersededUser, { code: secondCode })).status).toBe(200);
  });

  it("burns the code after the allowed wrong attempts, so even the right code is then refused", async () => {
    const user = await signIn("burned.code@example.com", "198.51.100.123");
    const code = await requestDeleteCode(user);
    for (let attempt = 0; attempt < OTP_MAX_ATTEMPTS; attempt += 1) {
      expect((await deleteWith(user, { code: wrongCodeFor(code) })).status).toBe(403);
    }
    const rightCode = await deleteWith(user, { code });
    expect(rightCode.status).toBe(429);
    expect(await rightCode.json()).toEqual({ error: tooManyAttempts });
    expect(await accountState(user)).toMatchObject({ users: [{ id: user.userId }], exportStatus: 200 });
  });

  it("parallel wrong guesses cannot outrun the limit: then even the right code is refused and nothing is touched", async () => {
    expect(RATE_LIMIT_WINDOW_SECONDS).toBeGreaterThanOrEqual(OTP_EXPIRY_SECONDS);
    const user = await signIn("parallel.guess@example.com", "198.51.100.126");
    const code = await requestDeleteCode(user);
    const before = await accountState(user);
    const guesses = 20;
    const statuses = await Promise.all(Array.from({ length: guesses }, async () => (await deleteWith(user, { code: wrongCodeFor(code) })).status));
    expect(statuses.filter((status) => status === 403)).toHaveLength(OTP_MAX_ATTEMPTS);
    expect(statuses.filter((status) => status === 429)).toHaveLength(guesses - OTP_MAX_ATTEMPTS);
    const rightCode = await accountRequest("DELETE", "/account", { cookie: user.cookie, body: { code }, ipAddress: "198.51.100.127" });
    expect(rightCode.status).toBe(429);
    expect(await accountState(user)).toEqual(before);

    const newCode = await requestDeleteCode(user);
    expect((await accountRequest("DELETE", "/account", { cookie: user.cookie, body: { code: newCode }, ipAddress: "198.51.100.127" })).status).toBe(
      200,
    );
  });

  it("limits DELETE /account per client IP across users", async () => {
    const ipAddress = "198.51.100.128";
    const triesPerUser = OTP_MAX_ATTEMPTS - 1;
    const users: SignedInUser[] = [];
    for (let index = 0; index <= MAX_VERIFIES_PER_IP_PER_WINDOW / triesPerUser; index += 1) {
      users.push(await signIn(`ip.limit.${index}@example.com`, ipAddress));
    }
    const last = users.at(-1);
    if (!last) {
      throw new Error("no users");
    }
    for (const user of users.slice(0, -1)) {
      for (let attempt = 0; attempt < triesPerUser; attempt += 1) {
        expect((await deleteWith(user, { code: "000000" })).status).toBe(403);
      }
    }
    const before = await accountState(last);
    expect((await deleteWith(last, { code: "000000" })).status).toBe(429);
    expect(await accountState(last)).toEqual(before);
    expect((await accountRequest("DELETE", "/account", { cookie: last.cookie, body: { code: "000000" }, ipAddress: "198.51.100.129" })).status).toBe(
      403,
    );
  });

  it("the public check endpoint cannot test delete codes, so it is no way around the DELETE limits", async () => {
    const user = await signIn("public.check@example.com", "198.51.100.130");
    const code = await requestDeleteCode(user);
    const publicCheck = await postAuthJson(current().app, "/email-otp/check-verification-otp", {
      body: { email: user.email, type: "email-verification", otp: code },
      ipAddress: "198.51.100.131",
    });
    expect(publicCheck.status).toBe(404);
    expect((await deleteWith(user, { code })).status).toBe(200);
  });

  it("delete codes share the per-email send limit with sign-in codes, and only the server can ask for one", async () => {
    const ipAddress = "198.51.100.124";
    const user = await signIn("code.limit@example.com", ipAddress);
    await requestDeleteCode(user);
    await requestDeleteCode(user);
    const sentBefore = current().emailSender.sentMessages.length;
    const refused = await accountRequest("POST", "/account/delete-code", { cookie: user.cookie });
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: "Too many codes requested. Try again later." });
    expect(current().emailSender.sentMessages).toHaveLength(sentBefore);

    const publicSend = await postAuthJson(current().app, "/email-otp/send-verification-otp", {
      body: { email: "public.send@example.com", type: "email-verification" },
      ipAddress: "198.51.100.125",
    });
    expect(publicSend.status).toBe(400);
    expect(current().emailSender.sentMessages.some((message) => message.to === "public.send@example.com")).toBe(false);
  });
});
