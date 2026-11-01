import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const backendDirectory = path.resolve(import.meta.dirname, "../..");
const builtMigrationsDirectory = path.join(backendDirectory, "dist/database/migrations");

describe("B1 backend build ships the SQL migrations", () => {
  it("copies every src migration into dist/database/migrations, and the migrate entry needs DATABASE_URL", () => {
    rmSync(builtMigrationsDirectory, { recursive: true, force: true });
    execFileSync("pnpm", ["run", "build"], { cwd: backendDirectory, stdio: "pipe" });
    const sourceMigrations = readdirSync(path.join(backendDirectory, "src/database/migrations")).filter((fileName) => fileName.endsWith(".sql"));
    const builtMigrations = readdirSync(builtMigrationsDirectory).filter((fileName) => fileName.endsWith(".sql"));
    expect(builtMigrations.length).toBeGreaterThan(0);
    expect(builtMigrations.sort()).toEqual(sourceMigrations.sort());

    const migrateWithoutDatabase = spawnSync("node", ["dist/database/migrator.js"], {
      cwd: backendDirectory,
      env: { PATH: process.env.PATH ?? "" },
      encoding: "utf8",
    });
    expect(migrateWithoutDatabase.status).not.toBe(0);
    expect(migrateWithoutDatabase.stderr).toContain("DATABASE_URL");
  }, 180_000);
});
