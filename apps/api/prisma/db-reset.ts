import { existsSync, rmSync } from "node:fs";
import { config as loadEnvironment } from "dotenv";
import { fileURLToPath } from "node:url";
import { initializeDatabase } from "../src/database-setup.js";
import { resolveDatabasePath } from "../src/database.js";

loadEnvironment({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

if (!process.argv.includes("--confirm")) {
  console.error("Database reset removes the configured SQLite file. Re-run with --confirm to proceed.");
  process.exitCode = 1;
} else {
  const databasePath = resolveDatabasePath();
  if (databasePath === ":memory:") {
    throw new Error("Cannot reset a temporary in-memory database");
  }

  for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    if (existsSync(path)) {
      rmSync(path);
    }
  }

  initializeDatabase(databasePath);
  console.log(`Reset ${databasePath} and applied the current SQLite migrations.`);
  console.log("The sample data was not seeded; run db:seed if required.");
}
