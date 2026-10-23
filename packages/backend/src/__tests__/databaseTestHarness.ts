import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import type { Kysely } from "kysely";
import { Client, Pool } from "pg";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDatabase, runDatabaseMigrations, withUserContext, type BjjRollDatabase } from "../database/index.js";

const postgresImage = "postgres:18.6";

export interface MigratedTestDatabase {
  pool: Pool;
  db: Kysely<BjjRollDatabase>;
  stop: () => Promise<void>;
}

export interface SeededUserFixture {
  id: string;
  emailCiphertext: string;
  emailHash: string;
  sessionId: string;
  sessionToken: string;
  accountId: string;
  verificationByUserId: string;
  verificationByEmailHashId: string;
}

export const userAlpha: SeededUserFixture = {
  id: "user-alpha-001",
  emailCiphertext: "v1:alpha-ciphertext",
  emailHash: "aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111",
  sessionId: "session-alpha-001",
  sessionToken: "token-alpha-001",
  accountId: "account-alpha-001",
  verificationByUserId: "verif-alpha-user-001",
  verificationByEmailHashId: "verif-alpha-hmac-001",
};

export const userBravo: SeededUserFixture = {
  id: "user-bravo-002",
  emailCiphertext: "v1:bravo-ciphertext",
  emailHash: "bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222",
  sessionId: "session-bravo-002",
  sessionToken: "token-bravo-002",
  accountId: "account-bravo-002",
  verificationByUserId: "verif-bravo-user-002",
  verificationByEmailHashId: "verif-bravo-hmac-002",
};

// Same rule as database.containerRoundTrip.test.ts: always runs in CI, skipped locally without Docker unless TEST_POSTGRES_URL is set.
export function isPostgresTestEnvironmentAvailable(): boolean {
  const configuredUrl = process.env.TEST_POSTGRES_URL ?? process.env.DATABASE_URL;
  if (configuredUrl && configuredUrl.trim().length > 0) {
    return true;
  }
  const dockerAvailable = existsSync("/var/run/docker.sock") || Boolean(process.env.DOCKER_HOST);
  return dockerAvailable || process.env.CI === "true";
}

export async function startMigratedTestDatabase(): Promise<MigratedTestDatabase> {
  const configuredUrl = process.env.TEST_POSTGRES_URL ?? process.env.DATABASE_URL;
  let container: StartedPostgreSqlContainer | undefined;
  let adminUrl: string | undefined;
  let isolatedDatabaseName: string | undefined;
  let connectionString: string;

  if (configuredUrl && configuredUrl.trim().length > 0) {
    adminUrl = configuredUrl.trim();
    isolatedDatabaseName = `bjj_test_${randomBytes(6).toString("hex")}`;
    const adminClient = new Client({ connectionString: adminUrl });
    await adminClient.connect();
    await adminClient.query(`CREATE DATABASE ${isolatedDatabaseName}`);
    await adminClient.end();
    const parsedUrl = new URL(adminUrl);
    parsedUrl.pathname = `/${isolatedDatabaseName}`;
    connectionString = parsedUrl.toString();
  } else {
    container = await new PostgreSqlContainer(postgresImage).start();
    connectionString = container.getConnectionUri();
  }

  const pool = new Pool({ connectionString, max: 6 });
  const db = createDatabase(pool);
  await runDatabaseMigrations(db);

  return {
    pool,
    db,
    stop: async () => {
      await db.destroy();
      if (adminUrl && isolatedDatabaseName) {
        const adminClient = new Client({ connectionString: adminUrl });
        await adminClient.connect();
        await adminClient.query(`DROP DATABASE IF EXISTS ${isolatedDatabaseName} WITH (FORCE)`);
        await adminClient.end();
      }
      if (container) {
        await container.stop();
      }
    },
  };
}

export async function seedFixtureUser(harness: MigratedTestDatabase, fixture: SeededUserFixture): Promise<void> {
  const futureExpiry = new Date(Date.now() + 3_600_000);
  await withUserContext(harness.db, fixture.id, async (transaction) => {
    await transaction
      .insertInto("users")
      .values({
        id: fixture.id,
        emailCiphertext: fixture.emailCiphertext,
        emailHash: fixture.emailHash,
        keyVersion: 1,
        emailVerified: true,
        handle: null,
      })
      .execute();

    await transaction
      .insertInto("sessions")
      .values({
        id: fixture.sessionId,
        userId: fixture.id,
        token: fixture.sessionToken,
        expiresAt: futureExpiry,
        ipAddress: "127.0.0.1",
        userAgent: "vitest",
      })
      .execute();

    await transaction
      .insertInto("accounts")
      .values({
        id: fixture.accountId,
        userId: fixture.id,
        accountId: fixture.id,
        providerId: "email-otp",
        accessToken: null,
        refreshToken: null,
        idToken: null,
        scope: null,
        password: null,
      })
      .execute();

    await transaction
      .insertInto("verifications")
      .values([
        {
          id: fixture.verificationByUserId,
          userId: fixture.id,
          identifier: `otp:${fixture.id}`,
          value: "hashed-otp-1",
          expiresAt: futureExpiry,
        },
        {
          id: fixture.verificationByEmailHashId,
          userId: null,
          identifier: `sign-in-otp-${fixture.emailHash}`,
          value: "hashed-otp-2",
          expiresAt: futureExpiry,
        },
      ])
      .execute();
  });
}
