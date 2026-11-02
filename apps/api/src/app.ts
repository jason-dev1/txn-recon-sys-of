import express from "express";
import type Database from "better-sqlite3";

export function isDatabaseReady(database: Pick<Database.Database, "prepare">): boolean {
  try {
    database.prepare("SELECT 1").get();
    return true;
  } catch {
    return false;
  }
}

export function createApp(database: Pick<Database.Database, "prepare">) {
  const app = express();

  app.use(express.json());

  app.get("/health", (_request, response) => {
    if (isDatabaseReady(database)) {
      response.json({ status: "ok" });
      return;
    }

    response.status(503).json({ status: "unavailable" });
  });

  return app;
}
