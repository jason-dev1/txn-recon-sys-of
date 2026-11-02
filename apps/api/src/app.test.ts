import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { isDatabaseReady } from "./app.js";

describe("database health check", () => {
  it("reports ready when SQLite can answer a query", () => {
    const database = new Database(":memory:");

    expect(isDatabaseReady(database)).toBe(true);
    database.close();
  });

  it("reports unavailable when SQLite cannot answer a query", () => {
    const database = new Database(":memory:");
    database.close();

    expect(isDatabaseReady(database)).toBe(false);
  });
});
