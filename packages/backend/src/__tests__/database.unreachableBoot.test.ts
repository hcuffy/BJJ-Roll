import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppFromEnvironment } from "../app.js";
import { GOOGLE_CLIENT_ID_ENV, GOOGLE_CLIENT_SECRET_ENV, generateTestAuthSecrets } from "../auth/index.js";
import { AUTH_BASE_URL_ENV, DATABASE_URL_ENV, EMAIL_FROM_ADDRESS_ENV, LETTERMINT_API_KEY_ENV } from "../serverConfig.js";

describe("B1 boot fails fast when the database is unreachable", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs db_unreachable and exits 1, never printing the connection string or password", async () => {
    const passwordMarker = `fake-pw-marker-${randomBytes(6).toString("hex")}`;
    const databaseUrl = `postgres://bjj_boot_user:${passwordMarker}@127.0.0.1:1/bjj_unreachable`;
    const output: string[] = [];
    const capture = (...parts: unknown[]) => {
      output.push(parts.map((part) => (part instanceof Error ? `${part.message} ${part.stack ?? ""}` : String(part))).join(" "));
    };
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, level).mockImplementation(capture);
    }
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      capture(chunk);
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      capture(chunk);
      return true;
    });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${String(code)})`);
    });

    const boot = createAppFromEnvironment({
      ...generateTestAuthSecrets(),
      [AUTH_BASE_URL_ENV]: "https://api.example.test",
      [DATABASE_URL_ENV]: databaseUrl,
      [LETTERMINT_API_KEY_ENV]: "lm-test-value-not-a-secret",
      [EMAIL_FROM_ADDRESS_ENV]: "login@example.test",
      [GOOGLE_CLIENT_ID_ENV]: "test-google-client.apps.example.test",
      [GOOGLE_CLIENT_SECRET_ENV]: "test-google-secret-not-real",
    });
    const failure = await boot.then(
      () => null,
      (error: unknown) => error,
    );
    capture(failure);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(output.join("\n")).toContain('"event":"db_unreachable"');
    for (const secret of [passwordMarker, databaseUrl, "bjj_boot_user", "127.0.0.1:1", "bjj_unreachable"]) {
      expect(output.join("\n")).not.toContain(secret);
    }
  }, 30_000);
});
