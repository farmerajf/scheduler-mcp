import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname, resolve } from "path";

const DB_PATH = resolve("./data/scheduler.db");

export function initDatabase(): Database.Database {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  console.log(`[db] Opening database: ${DB_PATH}`);

  const db = new Database(DB_PATH);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      name          TEXT NOT NULL,
      message       TEXT NOT NULL,
      schedule_type TEXT NOT NULL CHECK (schedule_type IN ('once', 'recurring')),
      schedule      TEXT NOT NULL,
      max_turns     INTEGER NOT NULL DEFAULT 10,
      enabled       INTEGER NOT NULL DEFAULT 1,
      notify        INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      last_run_at   TEXT,
      next_run_at   TEXT
    );

    CREATE TABLE IF NOT EXISTS runs (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      started_at  TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      status      TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
      output      TEXT,
      error       TEXT,
      turns_used  INTEGER,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_runs_task_id ON runs(task_id);
    CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at);
  `);

  // Mark any orphaned "running" runs as failed on startup
  const orphaned = db
    .prepare(`UPDATE runs SET status = 'failed', error = 'Server restarted during execution', finished_at = datetime('now') WHERE status = 'running'`)
    .run();

  if (orphaned.changes > 0) {
    console.warn(`[db] Marked ${orphaned.changes} orphaned run(s) as failed`);
  }
  console.log("[db] Database initialized");

  return db;
}
