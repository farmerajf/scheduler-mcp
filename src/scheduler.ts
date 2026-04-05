import type Database from "better-sqlite3";
import type { Config } from "./config.js";
import { executeTask } from "./executor.js";
import { computeNextRun, type Task } from "./tools/tasks.js";

export class Scheduler {
  private db: Database.Database;
  private config: Config;
  private intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private running: Set<string> = new Set();

  constructor(db: Database.Database, config: Config) {
    this.db = db;
    this.config = config;
    this.intervalMs = config.schedulerIntervalMs;
  }

  start(): void {
    const taskCount = this.db
      .prepare("SELECT COUNT(*) as count FROM tasks WHERE enabled = 1")
      .get() as { count: number };
    console.log(
      `[scheduler] Started (interval: ${this.intervalMs / 1000}s, enabled tasks: ${taskCount.count})`
    );
    this.tick();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log(`[scheduler] Stopped (${this.running.size} task(s) still running)`);
  }

  /** Advance next_run_at so the task stops appearing as "due" on subsequent ticks. */
  private advanceNextRun(task: Task): void {
    if (task.schedule_type === "recurring") {
      try {
        const next = computeNextRun(task.schedule_type, task.schedule);
        this.db
          .prepare("UPDATE tasks SET next_run_at = ?, updated_at = datetime('now') WHERE id = ?")
          .run(next, task.id);
        console.log(`[scheduler]   Advanced next_run_at to ${next} for "${task.name}"`);
      } catch (err) {
        console.error(`[scheduler] Failed to compute next run for "${task.name}" (${task.id}):`, err);
      }
    } else {
      // One-off: clear next_run_at so it can't be picked up again
      this.db
        .prepare("UPDATE tasks SET next_run_at = NULL, updated_at = datetime('now') WHERE id = ?")
        .run(task.id);
    }
  }

  private tick(): void {
    const now = new Date().toISOString();

    // Find enabled tasks that are due and not currently running
    const dueTasks = this.db
      .prepare(
        "SELECT * FROM tasks WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?"
      )
      .all(now) as Task[];

    if (dueTasks.length > 0) {
      console.log(`[scheduler] Tick: ${dueTasks.length} task(s) due at ${now}`);
    }

    for (const task of dueTasks) {
      // Fast-path: in-memory guard (covers normal operation within a single process)
      if (this.running.has(task.id)) {
        console.log(`[scheduler]   Skipping "${task.name}" (${task.id}): already running (in-memory)`);
        continue;
      }

      // DB-level guard: check for any existing running run (survives process restarts)
      const runningRun = this.db
        .prepare("SELECT id FROM runs WHERE task_id = ? AND status = 'running' LIMIT 1")
        .get(task.id) as { id: string } | undefined;
      if (runningRun) {
        console.log(`[scheduler]   Skipping "${task.name}" (${task.id}): already running in DB (run ${runningRun.id})`);
        this.advanceNextRun(task);
        continue;
      }

      this.running.add(task.id);
      console.log(`[scheduler]   Dispatching "${task.name}" (${task.id}), due at ${task.next_run_at}`);

      // Advance next_run_at BEFORE execution to prevent re-dispatch on restart
      this.advanceNextRun(task);

      // Create run record
      const run = this.db
        .prepare(
          "INSERT INTO runs (task_id, status) VALUES (?, 'running') RETURNING id"
        )
        .get(task.id) as { id: string };

      executeTask(this.db, task, this.config, run.id)
        .catch((err) => {
          console.error(`[scheduler] Task "${task.name}" (${task.id}) execution error:`, err);
          // Mark run as failed if executeTask itself throws
          this.db
            .prepare(
              `UPDATE runs SET status = 'failed', error = ?, finished_at = datetime('now') WHERE id = ? AND status = 'running'`
            )
            .run(String(err), run.id);
        })
        .finally(() => {
          this.running.delete(task.id);

          // Update last_run_at on completion
          if (task.schedule_type === "recurring") {
            this.db
              .prepare("UPDATE tasks SET last_run_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
              .run(task.id);
          } else {
            console.log(`[scheduler] One-off task "${task.name}" (${task.id}) completed, disabling`);
            this.db
              .prepare(
                "UPDATE tasks SET enabled = 0, last_run_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
              )
              .run(task.id);
          }
        });
    }
  }
}
