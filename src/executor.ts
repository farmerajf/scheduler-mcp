import { spawn } from "child_process";
import type Database from "better-sqlite3";
import type { Config } from "./config.js";
import type { Task } from "./tools/tasks.js";
import { sendNotification } from "./pushover.js";

export async function executeTask(
  db: Database.Database,
  task: Task,
  config: Config,
  runId: string
): Promise<void> {
  const claudePath = config.claudePath;
  const args: string[] = [
    "-p",
    task.message,
    "--output-format",
    "json",
    "--max-turns",
    String(task.max_turns),
    "--dangerously-skip-permissions",
    "--mcp-config",
    new URL("../mcp-servers.json", import.meta.url).pathname,
  ];

  console.log(`[executor] Starting task "${task.name}" (${task.id}), run ${runId}`);
  console.log(`[executor]   command: ${claudePath} ${args.map(a => a.length > 80 ? a.slice(0, 80) + "..." : a).join(" ")}`);

  const child = spawn(claudePath, args, {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const pid = child.pid;
  console.log(`[executor]   spawned pid: ${pid ?? "failed"}`);

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (data: Buffer) => {
    stdout += data.toString();
  });
  child.stderr.on("data", (data: Buffer) => {
    stderr += data.toString();
  });

  const exitCode = await new Promise<number | null>((resolve) => {
    child.on("close", (code) => resolve(code));
    child.on("error", (err) => {
      console.error(`[executor]   spawn error for run ${runId}: ${err.message}`);
      stderr += err.message;
      resolve(null);
    });
  });

  // Parse JSON output
  let turnsUsed: number | null = null;
  let resultText = stdout;
  try {
    const parsed = JSON.parse(stdout);
    resultText = parsed.result ?? stdout;
    turnsUsed = parsed.num_turns ?? null;
  } catch {
    // stdout was plain text, use as-is
  }

  const status = exitCode === 0 ? "completed" : "failed";

  console.log(`[executor] Run ${runId} finished: status=${status}, exit=${exitCode}, turns=${turnsUsed ?? "n/a"}, stdout=${stdout.length} bytes, stderr=${stderr.length} bytes`);
  if (status === "failed" && stderr) {
    console.error(`[executor]   stderr: ${stderr.slice(0, 500)}`);
  }

  db.prepare(
    `UPDATE runs SET
      finished_at = datetime('now'),
      status = ?,
      output = ?,
      error = ?,
      turns_used = ?
    WHERE id = ?`
  ).run(status, resultText, stderr || null, turnsUsed, runId);

  // Send notification if configured
  if (task.notify && config.pushover) {
    console.log(`[executor] Sending pushover notification for run ${runId}`);
    await sendNotification(config.pushover, {
      title: `Scheduler: ${task.name}`,
      message:
        status === "completed"
          ? "Task completed successfully."
          : `Task failed. Check run ${runId} for details.`,
    });
  }
}
