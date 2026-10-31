import { existsSync, promises as fileSystem } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql, type Kysely } from "kysely";
import { Migrator, type Migration, type MigrationProvider, type MigrationResult } from "kysely/migration";

function resolveDefaultMigrationsDirectory(): string {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const adjacentMigrations = path.join(moduleDirectory, "migrations");
  if (existsSync(adjacentMigrations)) {
    return adjacentMigrations;
  }
  return path.resolve(moduleDirectory, "../../src/database/migrations");
}

const defaultMigrationsDirectory = resolveDefaultMigrationsDirectory();

export class SqlFileMigrationProvider implements MigrationProvider {
  private readonly migrationsDirectory: string;

  public constructor(migrationsDirectory: string = defaultMigrationsDirectory) {
    this.migrationsDirectory = migrationsDirectory;
  }

  public async getMigrations(): Promise<Record<string, Migration>> {
    const entries = await fileSystem.readdir(this.migrationsDirectory, { withFileTypes: true });
    const sqlFiles = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));

    const migrations: Record<string, Migration> = {};
    for (const fileName of sqlFiles) {
      const migrationName = fileName.replace(/\.sql$/u, "");
      const fullPath = path.join(this.migrationsDirectory, fileName);
      const rawSql = await fileSystem.readFile(fullPath, "utf8");
      migrations[migrationName] = {
        async up(db: Kysely<unknown>): Promise<void> {
          await sql.raw(rawSql).execute(db);
        },
      };
    }
    return migrations;
  }
}

export async function runDatabaseMigrations<DatabaseType>(
  db: Kysely<DatabaseType>,
  migrationsDirectory: string = defaultMigrationsDirectory,
): Promise<MigrationResult[]> {
  const migrator = new Migrator({
    db,
    provider: new SqlFileMigrationProvider(migrationsDirectory),
  });
  const { error, results } = await migrator.migrateToLatest();
  if (error instanceof Error) {
    throw error;
  }
  if (error !== undefined) {
    throw new Error(`Database migration failed: ${JSON.stringify(error)}`);
  }
  return results ?? [];
}
