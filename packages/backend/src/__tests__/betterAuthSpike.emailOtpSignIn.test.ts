import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { allowedOtpAttempts, createSpikeAuth, otpExpirySeconds, sessionExpirySeconds, type SpikeAuth } from "./betterAuthSpike/spikeAuth.js";
import {
  containerTimeoutMilliseconds,
  dumpAuthTables,
  runSpikeDatabaseTests,
  startSpikeDatabase,
  type SpikeDatabase,
} from "./betterAuthSpike/spikeDatabase.js";
import { getWithCookie, postJson, sessionCookieFrom } from "./betterAuthSpike/spikeRequests.js";

describe.skipIf(!runSpikeDatabaseTests)("Better Auth spike: email OTP sign-in", () => {
  let database: SpikeDatabase | undefined;
  let spike: SpikeAuth | undefined;

  const started = () => {
    if (!database || !spike) {
      throw new Error("Spike database was not started");
    }
    return { pool: database.pool, ...spike };
  };

  const lastOtpFor = (email: string) => {
    const message = started()
      .sentMessages.filter((sent) => sent.kind === "otp" && sent.email === email.toLowerCase())
      .at(-1);
    if (!message) {
      throw new Error(`No OTP was sent to ${email}`);
    }
    return message.secret;
  };

  beforeAll(async () => {
    database = await startSpikeDatabase();
    spike = createSpikeAuth(database.pool);
  }, containerTimeoutMilliseconds);

  afterAll(async () => {
    await database?.stop();
  }, containerTimeoutMilliseconds);

  it("sends a code, verifies it and returns a session, storing no plaintext email or code", async () => {
    const { app, pool, protection, lookupCalls } = started();
    const email = "Roller.One@Example.com";
    const ipAddress = "203.0.113.1";

    const sendResponse = await postJson(app, "/email-otp/send-verification-otp", { body: { email, type: "sign-in" }, ipAddress });
    expect(sendResponse.status).toBe(200);
    const otp = lastOtpFor(email);
    expect(otp).toMatch(/^\d{6}$/);

    const signInResponse = await postJson(app, "/sign-in/email-otp", { body: { email, otp }, ipAddress });
    expect(signInResponse.status).toBe(200);
    const signIn = (await signInResponse.json()) as { token: string; user: { id: string; email: string } };
    expect(signIn.token).toBeTruthy();
    expect(signIn.user.email).toBe("roller.one@example.com");

    const sessionResponse = await getWithCookie(app, "http://localhost:3000/api/auth/get-session", {
      cookie: sessionCookieFrom(signInResponse),
      ipAddress,
    });
    const session = (await sessionResponse.json()) as { session: { userId: string; expiresAt: string }; user: { email: string } };
    expect(session.session.userId).toBe(signIn.user.id);
    expect(session.user.email).toBe("roller.one@example.com");
    const expiresInSeconds = (Date.parse(session.session.expiresAt) - Date.now()) / 1000;
    expect(Math.abs(expiresInSeconds - sessionExpirySeconds)).toBeLessThan(60);

    const stored = await dumpAuthTables(pool);
    expect(stored.toLowerCase()).not.toContain("roller.one@example.com");
    expect(stored).not.toContain(otp);
    const users = await pool.query<{ email_hash: string }>("SELECT email_hash FROM users WHERE id = $1", [signIn.user.id]);
    expect(users.rows[0]?.email_hash).toBe(protection.hashEmail(email));
    expect(lookupCalls).toContain(protection.hashEmail(email));
    console.warn(`[HEN-47 spike] OTP sign-in ok: user ${signIn.user.id}, session expires in ${Math.round(expiresInSeconds)} s`);
  });

  it("stores the code as a keyed hash under a hashed identifier, with a ten minute expiry", async () => {
    const { app, pool, protection } = started();
    const email = "expiry@example.com";
    await postJson(app, "/email-otp/send-verification-otp", { body: { email, type: "sign-in" }, ipAddress: "203.0.113.2" });
    const otp = lastOtpFor(email);
    const rows = await pool.query<{ value: string; lifetime: number }>(
      "SELECT value, extract(epoch FROM expires_at - created_at)::int AS lifetime FROM verifications WHERE identifier = $1",
      [protection.hashSecret(`sign-in-otp-${email}`)],
    );
    const storedValue = rows.rows[0]?.value ?? "";
    expect(storedValue).not.toContain(otp);
    expect(protection.decrypt(storedValue)).toBe(`${protection.hashSecret(otp)}:0`);
    expect(Math.abs((rows.rows[0]?.lifetime ?? 0) - otpExpirySeconds)).toBeLessThanOrEqual(2);
  });

  it("burns the code after the allowed number of wrong attempts", async () => {
    const { app } = started();
    const email = "attempts@example.com";
    const ipAddress = "203.0.113.3";
    await postJson(app, "/email-otp/send-verification-otp", { body: { email, type: "sign-in" }, ipAddress });
    const otp = lastOtpFor(email);
    const wrongOtp = otp === "000000" ? "111111" : "000000";

    const statuses: number[] = [];
    for (let attempt = 0; attempt < allowedOtpAttempts; attempt += 1) {
      const response = await postJson(app, "/sign-in/email-otp", { body: { email, otp: wrongOtp }, ipAddress });
      statuses.push(response.status);
    }
    const correctAfterLockout = await postJson(app, "/sign-in/email-otp", { body: { email, otp }, ipAddress });

    expect(statuses.every((status) => status >= 400)).toBe(true);
    expect(correctAfterLockout.status).toBeGreaterThanOrEqual(400);
  });

  it("still accepts the right code after one fewer wrong attempt than the limit", async () => {
    const { app } = started();
    const email = "almost@example.com";
    const ipAddress = "203.0.113.4";
    await postJson(app, "/email-otp/send-verification-otp", { body: { email, type: "sign-in" }, ipAddress });
    const otp = lastOtpFor(email);
    const wrongOtp = otp === "000000" ? "111111" : "000000";
    for (let attempt = 1; attempt < allowedOtpAttempts; attempt += 1) {
      await postJson(app, "/sign-in/email-otp", { body: { email, otp: wrongOtp }, ipAddress });
    }
    const correct = await postJson(app, "/sign-in/email-otp", { body: { email, otp }, ipAddress });
    expect(correct.status).toBe(200);
  });

  it("limits sends to three per email per window", async () => {
    const { app } = started();
    const statuses: number[] = [];
    for (let send = 0; send < 4; send += 1) {
      const response = await postJson(app, "/email-otp/send-verification-otp", {
        body: { email: "flood@example.com", type: "sign-in" },
        ipAddress: `198.51.100.${send + 1}`,
      });
      statuses.push(response.status);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it("limits sends to ten per IP per window, counted in Postgres", async () => {
    const { app, pool } = started();
    const statuses: number[] = [];
    for (let send = 0; send < 11; send += 1) {
      const response = await postJson(app, "/email-otp/send-verification-otp", {
        body: { email: `ip-flood-${send}@example.com`, type: "sign-in" },
        ipAddress: "192.0.2.50",
      });
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 10).every((status) => status === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
    const rateLimitRows = await pool.query<{ count: string }>("SELECT count(*) FROM rate_limits WHERE key NOT LIKE 'email-send:%'");
    expect(Number(rateLimitRows.rows[0]?.count)).toBeGreaterThan(0);
  });
});
