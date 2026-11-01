import type { Kysely } from "kysely";
import { createSqlFileMigrator } from "./migrator.js";

export interface SchemaVersion {
  readonly latestApplied: string | undefined;
  readonly newestBundled: string | undefined;
}

export async function readSchemaVersion<DatabaseType>(db: Kysely<DatabaseType>): Promise<SchemaVersion> {
  const migrations = await createSqlFileMigrator(db).getMigrations();
  return {
    latestApplied: migrations.findLast((migration) => migration.executedAt !== undefined)?.name,
    newestBundled: migrations.at(-1)?.name,
  };
}
