import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeEmailSender } from "../email/index.js";
import { isPostgresTestEnvironmentAvailable, startMigratedTestDatabase, type MigratedTestDatabase } from "./databaseTestHarness.js";
import { createTestEmailQueue } from "./emailQueueTestSupport.js";

describe.skipIf(!isPostgresTestEnvironmentAvailable())("HEN-284 durable email queue: startup without CREATE permission", () => {
  let database: MigratedTestDatabase | undefined;
  const roleName = `bjj_test_nocreate_${randomBytes(6).toString("hex")}`;
  const password = randomBytes(24).toString("hex");

  beforeAll(async () => {
    database = await startMigratedTestDatabase();
    await database.pool.query(`CREATE ROLE ${roleName} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${password}'`);
  }, 60_000);

  afterAll(async () => {
    await database?.pool.query(`DROP ROLE IF EXISTS ${roleName}`);
    await database?.stop();
  }, 30_000);

  it("fails with a clear message naming the CREATE permission the role needs", async () => {
    if (!database) {
      throw new Error("Test database not started");
    }
    const loginUrl = new URL(database.connectionString);
    loginUrl.username = roleName;
    loginUrl.password = password;
    const databaseName = loginUrl.pathname.slice(1);
    const { queue } = createTestEmailQueue({ connectionString: loginUrl.toString(), emailSender: new FakeEmailSender() });

    const started = queue.start();
    await expect(started).rejects.toThrow(
      `Email queue cannot start: database role "${roleName}" needs the CREATE permission on database "${databaseName}" ` +
        `to create the "pgboss" schema (GRANT CREATE ON DATABASE "${databaseName}" TO "${roleName}").`,
    );
    await queue.stop().catch(() => undefined);
  }, 30_000);
});
