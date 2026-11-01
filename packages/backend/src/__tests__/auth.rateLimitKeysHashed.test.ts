import { isIP } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isPostgresTestEnvironmentAvailable } from "./databaseTestHarness.js";
import { createAccountTestFlow } from "./accountTestFlow.js";
import { continueMagicLink, postAuthJson, startAuthTestEnvironment, testBaseUrl, type StartedAuthTestEnvironment } from "./authTestHelper.js";

const unknownLinkUrl = (token: string): string => `${testBaseUrl}/api/auth/magic-link/verify?token=${token}`;

const ipv4Pattern = /(?:\d{1,3}\.){3}\d{1,3}/u;
const ipv6Pattern = /(?:[0-9a-f]{1,4}:){2,}|::/iu;
const clientIps = ["198.51.100.141", "2001:db8::141", "::ffff:198.51.100.142"] as const;

function keyPartsLookLikeIps(key: string): boolean {
  return key.split(/[|/]/u).some((part) => isIP(part) !== 0);
}

describe.skipIf(!isPostgresTestEnvironmentAvailable())("B12 rate-limit keys never hold a plaintext client IP (D27)", () => {
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

  const { signIn, deleteAccount } = createAccountTestFlow(current);

  it("after code, link and account-delete attempts from IPv4 and IPv6 clients, no key matches an IP", async () => {
    for (const [index, ipAddress] of clientIps.entries()) {
      const user = await signIn(`ip.hash.${String(index)}@example.com`, ipAddress);
      await postAuthJson(current().app, "/sign-in/magic-link", { body: { email: user.email }, ipAddress });
      await continueMagicLink(current().app, unknownLinkUrl("not-a-real-token"), { ipAddress });
      expect((await deleteAccount(user)).status).toBe(200);
    }

    const keys = (await current().pool.query<{ key: string }>("SELECT key FROM public.rate_limits")).rows.map((row) => row.key);

    expect(keys.some((key) => key.startsWith("account-delete:ip:"))).toBe(true);
    expect(keys.some((key) => key.includes("|/email-otp/send-verification-otp"))).toBe(true);
    for (const key of keys) {
      expect(key).not.toMatch(ipv4Pattern);
      expect(key).not.toMatch(ipv6Pattern);
      expect(keyPartsLookLikeIps(key)).toBe(false);
      for (const ipAddress of [...clientIps, "198.51.100.142"]) {
        expect(key).not.toContain(ipAddress);
      }
    }
  }, 60_000);

  it("the same client still shares one counter per path, so IP limits keep working", async () => {
    const ipAddress = "198.51.100.143";
    const before = (await current().pool.query("SELECT key FROM public.rate_limits")).rowCount ?? 0;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await continueMagicLink(current().app, unknownLinkUrl("still-not-real"), { ipAddress });
    }

    const rows = await current().pool.query<{ key: string; count: number }>("SELECT key, count FROM public.rate_limits WHERE key = $1", [
      `${current().codec.hashClientIp(ipAddress)}|/magic-link/verify`,
    ]);
    expect(rows.rows).toEqual([expect.objectContaining({ count: 2 })]);
    expect((await current().pool.query("SELECT key FROM public.rate_limits")).rowCount).toBe(before + 1);
  });
});
