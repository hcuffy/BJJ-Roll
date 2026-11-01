import { describe, expect, it } from "vitest";
import { createServerPool, type ServerEventLine } from "../serverProcess.js";

describe("B11 an idle database client error is logged and never crashes the process", () => {
  it("logs the error class and code without the message", async () => {
    const lines: ServerEventLine[] = [];
    const pool = createServerPool("postgres://bjj_user:not-a-password@127.0.0.1:1/bjj", (line) => lines.push(line));
    const idleError = Object.assign(new Error("terminating connection for bjj_user at 127.0.0.1"), { code: "57P01" });

    expect(() => pool.emit("error", idleError)).not.toThrow();

    expect(lines).toEqual([{ event: "db_pool_error", errorClass: "Error", code: "57P01" }]);
    expect(JSON.stringify(lines)).not.toContain("bjj_user");
    await pool.end();
  });
});
