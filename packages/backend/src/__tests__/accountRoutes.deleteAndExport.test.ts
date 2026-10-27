import { accountDeletionResponseSchema, accountExportSchema } from "@bjj-roll/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { accountDeletionCascadeMap, verificationIdentifiersForEmailHash } from "../database/cascadeDelete.js";
import type { UserDataTableName } from "../database/schema.js";
import { isPostgresTestEnvironmentAvailable } from "./databaseTestHarness.js";
import { createAccountTestFlow, type SignedInUser } from "./accountTestFlow.js";
import { getAuthPath, startAuthTestEnvironment, testBaseUrl, type StartedAuthTestEnvironment } from "./authTestHelper.js";

describe.skipIf(!isPostgresTestEnvironmentAvailable())("HEN-65 DELETE /account and GET /account/export", () => {
  let environment: StartedAuthTestEnvironment | undefined;

  const current = (): StartedAuthTestEnvironment => {
    if (!environment) {
      throw new Error("Auth test environment not initialized");
    }
    return environment;
  };

  beforeAll(async () => {
    // Better Auth's own logger on at debug level, so the log test sees everything the server would print.
    environment = await startAuthTestEnvironment({ logger: { disabled: false, level: "debug" } });
  }, 60_000);

  afterAll(async () => {
    await environment?.stop();
  }, 30_000);

  const { signIn, accountRequest, requestDeleteCode, deleteAccount } = createAccountTestFlow(current);

  const setHandle = async (user: SignedInUser, handle: string): Promise<void> => {
    const response = await current().app.request(`${testBaseUrl}/handles`, {
      method: "POST",
      headers: { cookie: user.cookie, "content-type": "application/json" },
      body: JSON.stringify({ handle }),
    });
    expect(response.status).toBe(200);
  };

  /** Rows left for one user in each cascade-map table, read as the BYPASSRLS admin so RLS cannot hide any. */
  const remainingRowCounts = async (userId: string, emailHash: string): Promise<Record<UserDataTableName, number>> => {
    const { pool } = current();
    const countOf = async (query: string, parameters: unknown[]): Promise<number> => {
      const result = await pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${query}`, parameters);
      return result.rows[0]?.count ?? -1;
    };
    const countForTable = (table: UserDataTableName): Promise<number> => {
      switch (table) {
        case "users": {
          return countOf("public.users WHERE id = $1 OR email_hash = $2", [userId, emailHash]);
        }
        case "sessions": {
          return countOf("public.sessions WHERE user_id = $1", [userId]);
        }
        case "accounts": {
          return countOf("public.accounts WHERE user_id = $1", [userId]);
        }
        case "consent_records": {
          return countOf("public.consent_records WHERE user_id = $1", [userId]);
        }
        case "verifications": {
          return countOf("public.verifications WHERE user_id = $1 OR identifier = ANY($2::text[])", [
            userId,
            [...verificationIdentifiersForEmailHash(emailHash)],
          ]);
        }
      }
    };
    const counts: Partial<Record<UserDataTableName, number>> = {};
    for (const step of accountDeletionCascadeMap) {
      counts[step.table] = await countForTable(step.table);
    }
    return counts as Record<UserDataTableName, number>;
  };

  it("refuses both routes without a signed-in session (HTTP 401)", async () => {
    expect((await accountRequest("DELETE", "/account")).status).toBe(401);
    expect((await accountRequest("GET", "/account/export")).status).toBe(401);
    expect((await accountRequest("GET", "/account/export", { cookie: "better-auth.session_token=forged.value" })).status).toBe(401);
  });

  it("AC 1 + AC 2: delete removes every cascade-map row for the user, ends all their sessions, and leaves other users alone", async () => {
    const { codec } = current();
    const ipAddress = "198.51.100.101";
    const firstSession = await signIn("delete.alpha@example.com", ipAddress);
    const secondSession = await signIn("delete.alpha@example.com", ipAddress);
    expect(secondSession.userId).toBe(firstSession.userId);
    await setHandle(firstSession, "delete_alpha");
    // The pending delete code is a verification row the cascade must remove too (two sign-ins + this code = 3 sends, the per-email limit).
    const deleteCode = await requestDeleteCode(firstSession);
    const bystander = await signIn("delete.bystander@example.com", ipAddress);

    const alphaHash = codec.computeEmailHmac("delete.alpha@example.com");
    const bystanderHash = codec.computeEmailHmac("delete.bystander@example.com");
    const before = await remainingRowCounts(firstSession.userId, alphaHash);
    expect(before.users).toBe(1);
    expect(before.sessions).toBe(2);
    expect(before.verifications).toBeGreaterThan(0);
    const bystanderBefore = await remainingRowCounts(bystander.userId, bystanderHash);

    const response = await accountRequest("DELETE", "/account", { cookie: firstSession.cookie, body: { code: deleteCode } });
    expect(response.status).toBe(200);
    expect(accountDeletionResponseSchema.parse(await response.json())).toEqual({ deleted: true });

    const after = await remainingRowCounts(firstSession.userId, alphaHash);
    expect(Object.keys(after).sort()).toEqual(accountDeletionCascadeMap.map((step) => step.table).sort());
    expect(Object.values(after).every((count) => count === 0)).toBe(true);
    expect(await remainingRowCounts(bystander.userId, bystanderHash)).toEqual(bystanderBefore);

    for (const oldSession of [firstSession, secondSession]) {
      expect((await accountRequest("GET", "/account/export", { cookie: oldSession.cookie })).status).toBe(401);
      expect((await accountRequest("DELETE", "/account", { cookie: oldSession.cookie })).status).toBe(401);
      expect((await current().app.request(`${testBaseUrl}/handles/me`, { headers: { cookie: oldSession.cookie } })).status).toBe(401);
    }
    expect((await accountRequest("GET", "/account/export", { cookie: bystander.cookie })).status).toBe(200);
  });

  it("AC 3: export returns the caller's id, decrypted email, handle and createdAt, and nothing about another user", async () => {
    const ipAddress = "198.51.100.102";
    const alpha = await signIn("export.alpha@example.com", ipAddress);
    const bravo = await signIn("export.bravo@example.com", ipAddress);
    await setHandle(alpha, "export_alpha");
    await setHandle(bravo, "export_bravo");

    const response = await accountRequest("GET", "/account/export", { cookie: alpha.cookie });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const rawBody = await response.text();
    const exported = accountExportSchema.parse(JSON.parse(rawBody));

    const createdAtRow = await current().pool.query<{ created_at: Date }>("SELECT created_at FROM public.users WHERE id = $1", [alpha.userId]);
    expect(exported.user).toEqual({
      id: alpha.userId,
      email: "export.alpha@example.com",
      handle: "export_alpha",
      createdAt: createdAtRow.rows[0]?.created_at.toISOString(),
    });
    expect(rawBody).not.toContain(bravo.userId);
    expect(rawBody).not.toContain("export.bravo@example.com");
    expect(rawBody).not.toContain("export_bravo");
  });

  it("AC 4: user B cannot export or delete user A, even when naming A's id in a header, query or body", async () => {
    const ipAddress = "198.51.100.103";
    const alpha = await signIn("owner.alpha@example.com", ipAddress);
    const bravo = await signIn("owner.bravo@example.com", ipAddress);
    const spoofed = { cookie: bravo.cookie, headers: { "x-authenticated-user-id": alpha.userId, "x-user-id": alpha.userId } };

    const exportResponse = await accountRequest("GET", `/account/export?userId=${alpha.userId}`, spoofed);
    expect(exportResponse.status).toBe(200);
    const exported = accountExportSchema.parse(await exportResponse.json());
    expect(exported.user.id).toBe(bravo.userId);
    expect(exported.user.email).toBe("owner.bravo@example.com");

    const code = await requestDeleteCode(bravo);
    // Naming a user in the body is refused outright; the body carries the code and nothing else.
    expect((await accountRequest("DELETE", "/account", { ...spoofed, body: { code, userId: alpha.userId } })).status).toBe(400);
    const deleteResponse = await accountRequest("DELETE", `/account?userId=${alpha.userId}`, { ...spoofed, body: { code } });
    expect(deleteResponse.status).toBe(200);

    const alphaRows = await current().pool.query("SELECT id FROM public.users WHERE id = $1", [alpha.userId]);
    const bravoRows = await current().pool.query("SELECT id FROM public.users WHERE id = $1", [bravo.userId]);
    expect(alphaRows.rows).toEqual([{ id: alpha.userId }]);
    expect(bravoRows.rows).toEqual([]);
    expect((await accountRequest("GET", "/account/export", { cookie: alpha.cookie })).status).toBe(200);
  });

  it("AC 5: after deletion, signing in with the same email creates a fresh account with a new id", async () => {
    const ipAddress = "198.51.100.104";
    const original = await signIn("fresh.start@example.com", ipAddress);
    await setHandle(original, "fresh_start");
    expect((await deleteAccount(original)).status).toBe(200);

    const returning = await signIn("fresh.start@example.com", ipAddress);
    expect(returning.userId).not.toBe(original.userId);
    const exported = accountExportSchema.parse(await (await accountRequest("GET", "/account/export", { cookie: returning.cookie })).json());
    expect(exported.user).toMatchObject({ id: returning.userId, email: "fresh.start@example.com", handle: null });
    expect((await getAuthPath(current().app, "/get-session", { cookie: original.cookie, ipAddress })).status).toBe(200);
    expect(await (await getAuthPath(current().app, "/get-session", { cookie: original.cookie, ipAddress })).json()).toBeNull();
  });

  it("AC 6: delete and export log the user id and never the email or its hash", async () => {
    const { codec } = current();
    const ipAddress = "198.51.100.105";
    const email = "quiet.logs@example.com";
    const user = await signIn(email, ipAddress);

    const capturedLogs: string[] = [];
    const recordLog = (...entries: unknown[]) => {
      capturedLogs.push(entries.map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry))).join(" "));
    };
    const consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level).mockImplementation(recordLog));
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      recordLog(String(chunk).trimEnd());
      return true;
    });
    try {
      expect((await accountRequest("GET", "/account/export", { cookie: user.cookie })).status).toBe(200);
      expect((await deleteAccount(user)).status).toBe(200);
    } finally {
      stdoutSpy.mockRestore();
      for (const spy of consoleSpies) {
        spy.mockRestore();
      }
    }

    const exportLines = capturedLogs.filter((line) => line.includes("account_exported"));
    const deleteLines = capturedLogs.filter((line) => line.includes("account_deleted"));
    expect(exportLines).toHaveLength(1);
    expect(deleteLines).toHaveLength(1);
    expect(JSON.parse(exportLines[0] ?? "{}")).toEqual({ event: "account_exported", userId: user.userId });
    expect(JSON.parse(deleteLines[0] ?? "{}")).toEqual({ event: "account_deleted", userId: user.userId });

    const combinedLogs = capturedLogs.join("\n").toLowerCase();
    expect(combinedLogs).not.toContain(email);
    expect(combinedLogs).not.toContain("quiet.logs");
    expect(combinedLogs).not.toContain(codec.computeEmailHmac(email));
  });
});
