import { existsSync } from "node:fs";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dockerAvailable = existsSync("/var/run/docker.sock") || Boolean(process.env.DOCKER_HOST);
const runDatabaseTests = dockerAvailable || process.env.CI === "true";

const postgresImage = "postgres:18.6";
const containerTimeoutMilliseconds = 180_000;

describe.skipIf(!runDatabaseTests)("Postgres test container", () => {
  let container: StartedPostgreSqlContainer | undefined;
  let client: Client | undefined;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(postgresImage).start();
    client = new Client({ connectionString: container.getConnectionUri() });
    await client.connect();
  }, containerTimeoutMilliseconds);

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  }, containerTimeoutMilliseconds);

  it("creates a table, inserts a row and reads it back", async () => {
    if (!client) {
      throw new Error("Postgres client was not started");
    }
    await client.query("CREATE TABLE sample_rolls (id serial PRIMARY KEY, label text NOT NULL)");
    await client.query("INSERT INTO sample_rolls (label) VALUES ($1)", ["round trip"]);
    const result = await client.query<{ label: string }>("SELECT label FROM sample_rolls");

    expect(result.rows).toEqual([{ label: "round trip" }]);
  });

  it("runs the pinned Postgres major version", async () => {
    if (!client) {
      throw new Error("Postgres client was not started");
    }
    const result = await client.query<{ server_version: string }>("SHOW server_version");

    expect(result.rows[0]?.server_version).toMatch(/^18\.6/);
  });
});
