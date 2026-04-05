import type Database from "better-sqlite3";
import type { Config } from "../config.js";
import { executeTask } from "../executor.js";
import type { Task } from "./tasks.js";

export async function forceExecute(
  db: Database.Database,
  config: Config,
  params: { id: string; allow_concurrent?: boolean }
) {
  const task = db
    .prepare("SELECT * FROM tasks WHERE id = ?")
    .get(params.id) as Task | undefined;

  if (!task) {
    return {
      content: [
        { type: "text" as const, text: `Error: Task not found: ${params.id}` },
      ],
      isError: true,
    };
  }

  // Check for already-running instances unless explicitly allowed
  if (!params.allow_concurrent) {
    const runningRun = db
      .prepare("SELECT id FROM runs WHERE task_id = ? AND status = 'running' LIMIT 1")
      .get(task.id) as { id: string } | undefined;
    if (runningRun) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: Task "${task.name}" is already running (run ${runningRun.id}). Use allow_concurrent: true to override.`,
          },
        ],
        isError: true,
      };
    }
  }

  // Create run record and start execution asynchronously
  const runId = db
    .prepare(
      "INSERT INTO runs (task_id, status) VALUES (?, 'running') RETURNING id"
    )
    .get(task.id) as { id: string };

  // Execute in background - don't await
  executeTask(db, task, config, runId.id).catch((err) => {
    console.error(`Force execute failed for task ${task.id}:`, err);
  });

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            message: "Task execution started",
            task_id: task.id,
            task_name: task.name,
            run_id: runId.id,
          },
          null,
          2
        ),
      },
    ],
  };
}
