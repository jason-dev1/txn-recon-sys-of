import { config as loadEnvironment } from "dotenv";
import { fileURLToPath } from "node:url";
import { initializeDatabase } from "../src/database-setup.js";
import { resolveDatabasePath } from "../src/database.js";

loadEnvironment({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

const databasePath = resolveDatabasePath();
const result = initializeDatabase(databasePath);
console.log(
  result.applied.length > 0
    ? `Initialized ${databasePath}; applied ${result.applied.join(", ")}`
    : `Initialized ${databasePath}; schema is already current`,
);
