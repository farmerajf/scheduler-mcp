import type Database from "better-sqlite3";

export interface Run {
  id: string;
  task_id: string;
  started_at: string;
  finished_at: string | null;
  status: "running" | "completed" | "failed";
  output: string | null;
  error: string | null;
  turns_used: number | null;
  created_at: string;
}

export async function listRuns(
  db: Database.Database,
  params: { task_id: string; limit?: number }
) {
  const limit = params.limit ?? 20;

  const runs = db
    .prepare(
      `SELECT id, task_id, started_at, finished_at, status, turns_used, created_at
       FROM runs WHERE task_id = ? ORDER BY started_at DESC LIMIT ?`
    )
    .all(params.task_id, limit) as Omit<Run, "output" | "error">[];

  return {
    content: [{ type: "text" as const, text: JSON.stringify(runs, null, 2) }],
  };
}

export async function getRun(
  db: Database.Database,
  params: { id: string }
) {
  const run = db
    .prepare("SELECT * FROM runs WHERE id = ?")
    .get(params.id) as Run | undefined;

  if (!run) {
    return {
      content: [
        { type: "text" as const, text: `Error: Run not found: ${params.id}` },
      ],
      isError: true,
    };
  }

  return {
    content: [{ type: "text" as const, text: JSON.stringify(run, null, 2) }],
  };
}
