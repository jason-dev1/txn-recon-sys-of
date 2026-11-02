import { fileURLToPath, pathToFileURL } from "node:url";
import { isAbsolute, resolve } from "node:path";

import { defineConfig } from "prisma/config";
import { config as loadEnvironment } from "dotenv";

loadEnvironment({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

const apiRoot = fileURLToPath(new URL("./", import.meta.url));
const configuredPath = process.env.SQLITE_PATH?.trim() || "./data/reconciliation.db";
const sqlitePath = isAbsolute(configuredPath)
  ? configuredPath
  : resolve(apiRoot, configuredPath);

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: pathToFileURL(sqlitePath).href,
  },
});
