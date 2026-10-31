import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSpikeAuth, magicLinkExpirySeconds, type SpikeAuth } from "./betterAuthSpike/spikeAuth.js";
import {
  containerTimeoutMilliseconds,
  dumpAuthTables,
  runSpikeDatabaseTests,
  startSpikeDatabase,
  type SpikeDatabase,
} from "./betterAuthSpike/spikeDatabase.js";
import { getWithCookie, postJson, sessionCookieFrom } from "./betterAuthSpike/spikeRequests.js";

describe.skipIf(!runSpikeDatabaseTests)("Better Auth spike: magic link and pre-session lookup", () => {
  let database: SpikeDatabase | undefined;
  let spike: SpikeAuth | undefined;

  const started = () => {
    if (!database || !spike) {
      throw new Error("Spike database was not started");
    }
    return { pool: database.pool, ...spike };
  };

  beforeAll(async () => {
    database = await startSpikeDatabase();
    spike = createSpikeAuth(database.pool);
  }, containerTimeoutMilliseconds);

  afterAll(async () => {
    await database?.stop();
  }, containerTimeoutMilliseconds);

  it("signs in once through a magic link that redirects to bjjroll://, storing no plaintext email or token", async () => {
    const { app, pool, sentMessages } = started();
    const email = "link.roller@example.com";
    const ipAddress = "203.0.113.20";

    const sendResponse = await postJson(app, "/sign-in/magic-link", { body: { email, callbackURL: "bjjroll://signed-in" }, ipAddress });
    expect(sendResponse.status).toBe(200);
    const link = sentMessages.find((sent) => sent.kind === "magic-link" && sent.email === email)?.secret ?? "";
    const token = new URL(link).searchParams.get("token") ?? "";
    expect(token).not.toBe("");

    const stored = await dumpAuthTables(pool);
    expect(stored).not.toContain(email);
    expect(stored).not.toContain(token);
    const lifetime = await pool.query<{ lifetime: number }>("SELECT extract(epoch FROM expires_at - created_at)::int AS lifetime FROM verifications");
    expect(Math.abs((lifetime.rows[0]?.lifetime ?? 0) - magicLinkExpirySeconds)).toBeLessThanOrEqual(2);

    const firstUse = await getWithCookie(app, link, { ipAddress });
    expect(firstUse.status).toBe(302);
    expect(firstUse.headers.get("location")).toMatch(/^bjjroll:\/\/signed-in/);
    const cookie = sessionCookieFrom(firstUse);
    const sessionResponse = await getWithCookie(app, "http://localhost:3000/api/auth/get-session", { cookie, ipAddress });
    const session = (await sessionResponse.json()) as { user: { email: string } } | null;
    expect(session?.user.email).toBe(email);

    const secondUse = await getWithCookie(app, link, { ipAddress });
    expect(sessionCookieFrom(secondUse)).toBe("");
    expect(secondUse.headers.get("location") ?? "").toContain("error");
    console.warn(`[HEN-47 spike] magic link ok: first use ${firstUse.status} to bjjroll://, second use refused`);
  });

  it("hides users from bjj_app but lets the SECURITY DEFINER function return only the user id", async () => {
    const { pool, protection } = started();
    const users = await pool.query<{ id: string }>("SELECT id FROM users LIMIT 1");
    const userId = users.rows[0]?.id;
    const emailHash = protection.hashEmail("link.roller@example.com");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE bjj_app");
      const visibleRows = await client.query("SELECT id FROM users");
      const lookup = await client.query<{ user_id: string }>("SELECT auth_lookup_user_id($1) AS user_id", [emailHash]);
      await client.query("ROLLBACK");
      expect(visibleRows.rowCount).toBe(0);
      expect(lookup.rows[0]?.user_id).toBe(userId);
    } finally {
      client.release();
    }

    const roles = await pool.query<{ rolname: string; rolbypassrls: boolean }>(
      "SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname IN ('bjj_app', 'bjj_auth_lookup') ORDER BY rolname",
    );
    expect(roles.rows).toEqual([
      { rolname: "bjj_app", rolbypassrls: false },
      { rolname: "bjj_auth_lookup", rolbypassrls: false },
    ]);
    const lookupFunction = await pool.query<{ owner: string; security_definer: boolean; settings: string[] }>(
      `SELECT pg_get_userbyid(proowner) AS owner, prosecdef AS security_definer, proconfig AS settings
       FROM pg_proc WHERE proname = 'auth_lookup_user_id'`,
    );
    expect(lookupFunction.rows[0]).toEqual({ owner: "bjj_auth_lookup", security_definer: true, settings: ["search_path=pg_catalog, pg_temp"] });
  });
});
