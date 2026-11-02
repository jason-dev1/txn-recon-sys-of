import { openDatabase, resolveDatabasePath } from "./database.js";
import { getMigrationsDirectory, runMigrations } from "./migrations.js";

export function initializeDatabase(databasePath = resolveDatabasePath()) {
  const database = openDatabase(databasePath);
  try {
    return runMigrations(database, getMigrationsDirectory());
  } finally {
    database.close();
  }
}
