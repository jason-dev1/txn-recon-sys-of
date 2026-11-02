import { dirname, isAbsolute, resolve } from "node:path";

import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

export function resolveDatabasePath(databasePath?: string): string {
  const configuredPath = databasePath?.trim() || process.env.SQLITE_PATH?.trim();
  if (configuredPath === ":memory:") {
    return configuredPath;
  }

  const apiRoot = fileURLToPath(new URL("../", import.meta.url));
  const path = configuredPath || "./data/reconciliation.db";
  return isAbsolute(path) ? path : resolve(apiRoot, path);
}

export function openDatabase(databasePath = resolveDatabasePath()): Database.Database {
  if (databasePath !== ":memory:") {
    const resolvedPath = resolveDatabasePath(databasePath);
    mkdirSync(dirname(resolvedPath), { recursive: true });
    databasePath = resolvedPath;
  }

  const database = new Database(databasePath);
  database.pragma("foreign_keys = ON");
  database.pragma("journal_mode = WAL");
  return database;
}
