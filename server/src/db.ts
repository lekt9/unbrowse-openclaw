/**
 * Database layer for the skill index server.
 *
 * Uses Bun's built-in SQLite for zero-dependency persistence.
 */

import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let db: Database;

export function getDb(): Database {
  if (!db) throw new Error("Database not initialized. Call initDb() first.");
  return db;
}

export function initDb(dbPath?: string): Database {
  const path = dbPath ?? process.env.DB_PATH ?? join(__dirname, "..", "skills.db");
  db = new Database(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  // Apply schema
  const schema = readFileSync(join(__dirname, "schema.sql"), "utf-8");
  db.exec(schema);

  return db;
}
