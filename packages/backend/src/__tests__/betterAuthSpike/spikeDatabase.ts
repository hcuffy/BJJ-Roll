import { existsSync } from "node:fs";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { spikeSchemaSql, spikeTables } from "./spikeSchema.js";

// Same rule as database.containerRoundTrip.test.ts: always runs in CI, skipped locally without Docker.
const dockerAvailable = existsSync("/var/run/docker.sock") || Boolean(process.env.DOCKER_HOST);
export const runSpikeDatabaseTests = dockerAvailable || process.env.CI === "true";
export const containerTimeoutMilliseconds = 180_000;

export interface SpikeDatabase {
  pool: Pool;
  stop: () => Promise<void>;
}

export async function startSpikeDatabase(): Promise<SpikeDatabase> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer("postgres:18.6").start();
  const pool = new Pool({ connectionString: container.getConnectionUri(), max: 5 });
  await pool.query(spikeSchemaSql);
  return {
    pool,
    stop: async () => {
      await pool.end();
      await container.stop();
    },
  };
}

// Every row of every auth table as text, so a test can prove a plaintext value is stored nowhere.
export async function dumpAuthTables(pool: Pool): Promise<string> {
  const dumps = await Promise.all(spikeTables.map((table) => pool.query<{ row: string }>(`SELECT row_to_json(t)::text AS row FROM ${table} t`)));
  return dumps.flatMap((dump) => dump.rows.map((entry) => entry.row)).join("\n");
}
