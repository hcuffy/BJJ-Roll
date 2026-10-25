import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MAX_SENDS_PER_IP_PER_WINDOW, SESSION_ABSOLUTE_MAX_LIFETIME_SECONDS, SESSION_SLIDING_EXPIRY_SECONDS } from "../auth/index.js";
import { isPostgresTestEnvironmentAvailable } from "./databaseTestHarness.js";
import { extractSessionCookie, getAuthPath, postAuthJson, startAuthTestEnvironment, type StartedAuthTestEnvironment } from "./authTestHelper.js";

describe.skipIf(!isPostgresTestEnvironmentAvailable())("HEN-71 session lifetime (AC 8)", () => {
  let environment: StartedAuthTestEnvironment | undefined;

  const current = (): StartedAuthTestEnvironment => {
    if (!environment) {
      throw new Error("Auth test environment not initialized");
    }
    return environment;
  };

  const latestOtpFor = (email: string): string => {
    const sent = current()
      .emailSender.sentMessages.filter((message) => message.kind === "one_time_code" && message.to.toLowerCase() === email)
      .at(-1);
    if (sent?.kind !== "one_time_code") {
      throw new Error(`No OTP sent for ${email}`);
    }
    return sent.code;
  };

  beforeAll(async () => {
    environment = await startAuthTestEnvironment();
  }, 60_000);

  afterAll(async () => {
    await environment?.stop();
  }, 30_000);

  const signInWithOtp = async (email: string, ipAddress: string): Promise<{ cookie: string; token: string; userId: string }> => {
    const { app } = current();
    await postAuthJson(app, "/email-otp/send-verification-otp", { body: { email, type: "sign-in", ageConfirmed: true }, ipAddress });
    const response = await postAuthJson(app, "/sign-in/email-otp", { body: { email, otp: latestOtpFor(email) }, ipAddress });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { token: string; user: { id: string } };
    return { cookie: extractSessionCookie(response), token: body.token, userId: body.user.id };
  };

  const readSessionRow = async (userId: string) => {
    const result = await current().pool.query<{ token: string; created_at: Date; updated_at: Date; expires_at: Date }>(
      "SELECT token, created_at, updated_at, expires_at FROM public.sessions WHERE user_id = $1",
      [userId],
    );
    return result.rows;
  };

  const dayMs = 24 * 60 * 60 * 1000;

  it("AC 8 (fake clock): session token stored hashed; one write per day of use; idle 30 days rejected", async () => {
    const { app, codec } = current();
    const ipAddress = "198.51.100.70";
    const startMs = Date.parse("2026-04-01T08:00:00.000Z");
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(startMs);
      const session = await signInWithOtp("session.idle@example.com", ipAddress);
      const [created] = await readSessionRow(session.userId);
      expect(created?.token).toBe(codec.hashSessionToken(session.token));
      expect(created?.token).not.toBe(session.token);

      // Two uses on the same day (within updateAge): no write.
      vi.setSystemTime(startMs + 2 * 60 * 60 * 1000);
      expect((await getAuthPath(app, "/get-session", { cookie: session.cookie, ipAddress })).status).toBe(200);
      vi.setSystemTime(startMs + 3 * 60 * 60 * 1000);
      expect((await getAuthPath(app, "/get-session", { cookie: session.cookie, ipAddress })).status).toBe(200);
      const [sameDay] = await readSessionRow(session.userId);
      expect(sameDay?.updated_at.getTime()).toBe(created?.updated_at.getTime());

      // Two uses the next day: exactly one write (first use slides, second does not).
      const nextDayFirstMs = startMs + dayMs + 60 * 60 * 1000;
      vi.setSystemTime(nextDayFirstMs);
      expect((await getAuthPath(app, "/get-session", { cookie: session.cookie, ipAddress })).status).toBe(200);
      vi.setSystemTime(nextDayFirstMs + 60 * 60 * 1000);
      expect((await getAuthPath(app, "/get-session", { cookie: session.cookie, ipAddress })).status).toBe(200);
      const [nextDay] = await readSessionRow(session.userId);
      expect(nextDay?.updated_at.getTime()).toBe(nextDayFirstMs);
      expect(nextDay?.expires_at.getTime()).toBe(nextDayFirstMs + SESSION_SLIDING_EXPIRY_SECONDS * 1000);

      // Idle for 30 days plus 1 second after the last write: rejected.
      vi.setSystemTime(nextDayFirstMs + SESSION_SLIDING_EXPIRY_SECONDS * 1000 + 1000);
      const idleResponse = await getAuthPath(app, "/get-session", { cookie: session.cookie, ipAddress });
      expect(await idleResponse.json()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("AC 8 (fake clock): sliding sessions used every 20 days are capped at 90 days from creation", async () => {
    const { app } = current();
    const ipAddress = "198.51.100.71";
    const startMs = Date.parse("2026-05-01T08:00:00.000Z");
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(startMs);
      const session = await signInWithOtp("session.cap@example.com", ipAddress);
      for (const day of [20, 40, 60, 80, 89]) {
        vi.setSystemTime(startMs + day * dayMs);
        const response = await getAuthPath(app, "/get-session", { cookie: session.cookie, ipAddress });
        expect({ day, ok: (await response.json()) !== null }).toEqual({ day, ok: true });
        const [row] = await readSessionRow(session.userId);
        expect(row?.expires_at.getTime()).toBeLessThanOrEqual(startMs + SESSION_ABSOLUTE_MAX_LIFETIME_SECONDS * 1000);
      }
      vi.setSystemTime(startMs + SESSION_ABSOLUTE_MAX_LIFETIME_SECONDS * 1000 + 1000);
      const cappedResponse = await getAuthPath(app, "/get-session", { cookie: session.cookie, ipAddress });
      expect(await cappedResponse.json()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe.skipIf(!isPostgresTestEnvironmentAvailable())("HEN-71 opt-in proxy header trust", () => {
  let environment: StartedAuthTestEnvironment | undefined;

  beforeAll(async () => {
    environment = await startAuthTestEnvironment({ trustedProxyIpHeaders: ["x-forwarded-for"] });
  }, 60_000);

  afterAll(async () => {
    await environment?.stop();
  }, 30_000);

  it("with x-forwarded-for trusted, the rightmost hop is the client: distinct clients are separate, a spoofed left entry is not", async () => {
    if (!environment) {
      throw new Error("Auth test environment not initialized");
    }
    const { app } = environment;
    const proxySocket = "10.0.0.5";
    for (let count = 1; count <= 15; count += 1) {
      const response = await postAuthJson(app, "/email-otp/send-verification-otp", {
        body: { email: `trusted.client.${String(count)}@example.com`, type: "sign-in", ageConfirmed: true },
        ipAddress: proxySocket,
        headers: { "x-forwarded-for": `203.0.113.${String(count)}` },
      });
      expect(response.status).toBe(200);
    }

    const statuses: number[] = [];
    for (let count = 1; count <= 12; count += 1) {
      const response = await postAuthJson(app, "/email-otp/send-verification-otp", {
        body: { email: `trusted.spoof.${String(count)}@example.com`, type: "sign-in", ageConfirmed: true },
        ipAddress: proxySocket,
        headers: { "x-forwarded-for": `192.0.2.${String(count)}, 203.0.113.200` },
      });
      statuses.push(response.status);
    }
    expect(statuses).toEqual([...Array<number>(MAX_SENDS_PER_IP_PER_WINDOW).fill(200), 429, 429]);
  });
});
