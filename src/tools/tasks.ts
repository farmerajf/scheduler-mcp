import type Database from "better-sqlite3";
import { CronExpressionParser } from "cron-parser";

export interface Task {
  id: string;
  name: string;
  message: string;
  schedule_type: "once" | "recurring";
  schedule: string;
  max_turns: number;
  enabled: number;
  notify: number;
  created_at: string;
  updated_at: string;
  last_run_at: string | null;
  next_run_at: string | null;
}

export function computeNextRun(
  scheduleType: string,
  schedule: string
): string | null {
  if (scheduleType === "once") {
    const dt = new Date(schedule);
    if (isNaN(dt.getTime())) {
      throw new Error(`Invalid datetime: ${schedule}`);
    }
    if (dt > new Date()) {
      return dt.toISOString();
    }
    return null;
  }

  if (scheduleType === "recurring") {
    const expr = CronExpressionParser.parse(schedule);
    const next = expr.next().toDate();
    return next.toISOString();
  }

  return null;
}

function validateSchedule(scheduleType: string, schedule: string): void {
  if (scheduleType === "once") {
    const dt = new Date(schedule);
    if (isNaN(dt.getTime())) {
      throw new Error(
        `Invalid ISO datetime: "${schedule}". Use format like "2026-03-15T09:00:00"`
      );
    }
  } else if (scheduleType === "recurring") {
    try {
      CronExpressionParser.parse(schedule);
    } catch {
      throw new Error(
        `Invalid cron expression: "${schedule}". Use format like "0 9 * * 1-5" (weekdays at 9am)`
      );
    }
  }
}

export async function createTask(
  db: Database.Database,
  params: {
    name: string;
    message: string;
    schedule_type: "once" | "recurring";
    schedule: string;
    max_turns?: number;
    enabled?: boolean;
    notify?: boolean;
  }
) {
  validateSchedule(params.schedule_type, params.schedule);

  const nextRun = computeNextRun(params.schedule_type, params.schedule);
  const enabled = params.enabled !== false ? 1 : 0;
  const notify = params.notify === true ? 1 : 0;
  const maxTurns = params.max_turns ?? 10;

  const stmt = db.prepare(`
    INSERT INTO tasks (name, message, schedule_type, schedule, max_turns, enabled, notify, next_run_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    params.name,
    params.message,
    params.schedule_type,
    params.schedule,
    maxTurns,
    enabled,
    notify,
    nextRun
  );

  const task = db
    .prepare("SELECT * FROM tasks WHERE rowid = ?")
    .get(result.lastInsertRowid) as Task;

  return {
    content: [{ type: "text" as const, text: JSON.stringify(task, null, 2) }],
  };
}

export async function updateTask(
  db: Database.Database,
  params: {
    id: string;
    name?: string;
    message?: string;
    schedule_type?: "once" | "recurring";
    schedule?: string;
    max_turns?: number;
    enabled?: boolean;
    notify?: boolean;
  }
) {
  const existing = db
    .prepare("SELECT * FROM tasks WHERE id = ?")
    .get(params.id) as Task | undefined;

  if (!existing) {
    return {
      content: [
        { type: "text" as const, text: `Error: Task not found: ${params.id}` },
      ],
      isError: true,
    };
  }

  const updates: string[] = [];
  const values: unknown[] = [];

  if (params.name !== undefined) {
    updates.push("name = ?");
    values.push(params.name);
  }
  if (params.message !== undefined) {
    updates.push("message = ?");
    values.push(params.message);
  }
  if (params.schedule_type !== undefined) {
    updates.push("schedule_type = ?");
    values.push(params.schedule_type);
  }
  if (params.schedule !== undefined) {
    updates.push("schedule = ?");
    values.push(params.schedule);
  }
  if (params.max_turns !== undefined) {
    updates.push("max_turns = ?");
    values.push(params.max_turns);
  }
  if (params.enabled !== undefined) {
    updates.push("enabled = ?");
    values.push(params.enabled ? 1 : 0);
  }
  if (params.notify !== undefined) {
    updates.push("notify = ?");
    values.push(params.notify ? 1 : 0);
  }

  // Recompute next_run_at if schedule changed
  const newScheduleType =
    params.schedule_type ?? existing.schedule_type;
  const newSchedule = params.schedule ?? existing.schedule;

  if (params.schedule_type !== undefined || params.schedule !== undefined) {
    validateSchedule(newScheduleType, newSchedule);
    const nextRun = computeNextRun(newScheduleType, newSchedule);
    updates.push("next_run_at = ?");
    values.push(nextRun);
  }

  if (updates.length === 0) {
    return {
      content: [
        { type: "text" as const, text: "No fields to update" },
      ],
    };
  }

  updates.push("updated_at = datetime('now')");
  values.push(params.id);

  db.prepare(
    `UPDATE tasks SET ${updates.join(", ")} WHERE id = ?`
  ).run(...values);

  const task = db
    .prepare("SELECT * FROM tasks WHERE id = ?")
    .get(params.id) as Task;

  return {
    content: [{ type: "text" as const, text: JSON.stringify(task, null, 2) }],
  };
}

export async function deleteTask(
  db: Database.Database,
  params: { id: string }
) {
  const existing = db
    .prepare("SELECT * FROM tasks WHERE id = ?")
    .get(params.id) as Task | undefined;

  if (!existing) {
    return {
      content: [
        { type: "text" as const, text: `Error: Task not found: ${params.id}` },
      ],
      isError: true,
    };
  }

  db.prepare("DELETE FROM tasks WHERE id = ?").run(params.id);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          { deleted: true, id: params.id, name: existing.name },
          null,
          2
        ),
      },
    ],
  };
}

export async function getTask(
  db: Database.Database,
  params: { id: string }
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

  return {
    content: [{ type: "text" as const, text: JSON.stringify(task, null, 2) }],
  };
}

export async function listTasks(
  db: Database.Database,
  params: { enabled_only?: boolean }
) {
  const query = params.enabled_only
    ? "SELECT * FROM tasks WHERE enabled = 1 ORDER BY created_at DESC"
    : "SELECT * FROM tasks ORDER BY created_at DESC";

  const tasks = db.prepare(query).all() as Task[];

  return {
    content: [{ type: "text" as const, text: JSON.stringify(tasks, null, 2) }],
  };
}
