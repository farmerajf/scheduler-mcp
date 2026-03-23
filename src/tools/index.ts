import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type Database from "better-sqlite3";
import type { Config } from "../config.js";
import { createTask, updateTask, deleteTask, getTask, listTasks } from "./tasks.js";
import { listRuns, getRun } from "./runs.js";
import { forceExecute } from "./execute.js";

export function registerTools(
  server: McpServer,
  db: Database.Database,
  config: Config
): void {
  // ========================================
  // TASK CRUD
  // ========================================

  server.tool(
    "create_task",
    "Create a new scheduled task. The task message will be executed by Claude Code in headless mode at the scheduled time.",
    {
      name: z.string().describe("Human-readable name for the task"),
      message: z
        .string()
        .describe("The prompt message to send to Claude Code at execution time"),
      schedule_type: z
        .enum(["once", "recurring"])
        .describe(
          "'once' for one-time execution, 'recurring' for repeated execution"
        ),
      schedule: z
        .string()
        .describe(
          "ISO 8601 datetime for 'once' (e.g., '2026-03-15T09:00:00'), or cron expression for 'recurring' (e.g., '0 9 * * 1-5' for weekdays at 9am)"
        ),
      max_turns: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(10)
        .describe("Maximum agentic turns Claude Code can take (default: 10)"),
      enabled: z
        .boolean()
        .default(true)
        .describe("Whether the task is active"),
      notify: z
        .boolean()
        .default(false)
        .describe("Send a Pushover notification when the task completes"),
    },
    async (params) => {
      try {
        return await createTask(db, params);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "update_task",
    "Update an existing scheduled task. Only provided fields are modified.",
    {
      id: z.string().describe("Task ID"),
      name: z.string().optional().describe("Human-readable name"),
      message: z.string().optional().describe("Prompt message for Claude Code"),
      schedule_type: z
        .enum(["once", "recurring"])
        .optional()
        .describe("Schedule type"),
      schedule: z
        .string()
        .optional()
        .describe("ISO datetime or cron expression"),
      max_turns: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Maximum agentic turns"),
      enabled: z.boolean().optional().describe("Whether the task is active"),
      notify: z
        .boolean()
        .optional()
        .describe("Send Pushover notification on completion"),
    },
    async (params) => {
      try {
        return await updateTask(db, params);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "delete_task",
    "Delete a scheduled task and all its run history.",
    {
      id: z.string().describe("Task ID to delete"),
    },
    async (params) => {
      try {
        return await deleteTask(db, params);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_task",
    "Get detailed information about a specific task, including its next scheduled run time.",
    {
      id: z.string().describe("Task ID"),
    },
    async (params) => {
      try {
        return await getTask(db, params);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "list_tasks",
    "List all scheduled tasks with their status and next run time.",
    {
      enabled_only: z
        .boolean()
        .default(false)
        .describe("Only show enabled tasks"),
    },
    async (params) => {
      try {
        return await listTasks(db, params);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  // ========================================
  // EXECUTION
  // ========================================

  server.tool(
    "force_execute",
    "Immediately execute a task regardless of its schedule. The task runs asynchronously — use get_run to check the result.",
    {
      id: z.string().describe("Task ID to execute immediately"),
    },
    async (params) => {
      try {
        return await forceExecute(db, config, params);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  // ========================================
  // RUN HISTORY
  // ========================================

  server.tool(
    "list_runs",
    "List execution runs for a task, ordered by most recent first.",
    {
      task_id: z.string().describe("Task ID"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe("Maximum number of runs to return"),
    },
    async (params) => {
      try {
        return await listRuns(db, params);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_run",
    "Get full details of a specific execution run, including output.",
    {
      id: z.string().describe("Run ID"),
    },
    async (params) => {
      try {
        return await getRun(db, params);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
