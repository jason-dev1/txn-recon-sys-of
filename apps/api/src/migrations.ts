import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";

type MigrationResult = {
  applied: string[];
  skipped: string[];
};

export function getMigrationsDirectory(): string {
  return fileURLToPath(new URL("../sql/migrations/", import.meta.url));
}

export function runMigrations(database: Database.Database, migrationsDirectory: string): MigrationResult {
  const foreignKeysEnabled = database.pragma("foreign_keys", { simple: true });
  if (foreignKeysEnabled !== 1) {
    throw new Error("SQLite foreign key enforcement must be enabled before migrations run");
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      migration_id VARCHAR(255) NOT NULL PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const migrations = readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();

  const hasMigration = database.prepare(
    "SELECT 1 FROM schema_migrations WHERE migration_id = ?",
  );
  const recordMigration = database.prepare(
    "INSERT INTO schema_migrations (migration_id) VALUES (?)",
  );
  const applied: string[] = [];
  const skipped: string[] = [];

  const applyMigration = database.transaction((name: string, sql: string) => {
    if (hasMigration.get(name)) {
      return false;
    }

    database.exec(sql);
    recordMigration.run(name);
    return true;
  });

  for (const name of migrations) {
    const sql = readFileSync(join(migrationsDirectory, name), "utf8");
    const didApply = applyMigration.immediate(name, sql);
    (didApply ? applied : skipped).push(name);
  }

  return { applied, skipped };
}
