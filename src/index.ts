import { createHmac } from "node:crypto";
import express, { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, type Config } from "./config.js";
import { initDatabase } from "./db.js";
import { registerTools } from "./tools/index.js";
import { Scheduler } from "./scheduler.js";

const config = loadConfig(process.env.CONFIG_PATH);
console.log(`[server] Config loaded (transport: ${config.transport})`);
const db = initDatabase();

function createMcpServer(config: Config): McpServer {
  const server = new McpServer(
    { name: "scheduler", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions: [
        "Schedule tasks for automated execution by Claude Code in headless mode.",
        "Tasks can be one-off (ISO datetime like '2026-03-15T09:00:00') or recurring (cron expression like '0 9 * * 1-5').",
        "Each task is a Claude prompt that runs with configurable max turns.",
        "Use create_task to schedule, list_tasks to see all tasks, force_execute to run immediately, and list_runs/get_run to check results.",
      ].join(" "),
    }
  );
  registerTools(server, db, config);
  return server;
}

if (config.transport === "stdio") {
  startStdioServer(config);
} else {
  startHttpServer(config);
}

// Stdio transport for local use (Claude Desktop, etc.)
async function startStdioServer(config: Config): Promise<void> {
  const server = createMcpServer(config);
  const transport = new StdioServerTransport();

  console.log("[server] Starting in stdio mode");

  await server.connect(transport);

  const scheduler = new Scheduler(db, config);
  scheduler.start();

  process.on("SIGINT", () => {
    scheduler.stop();
    db.close();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    scheduler.stop();
    db.close();
    process.exit(0);
  });
}

// Streamable HTTP transport for remote use
function startHttpServer(config: Config): void {
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const app = express();
  app.use((req, _res, next) => {
    console.log(`[http] --> ${req.method} ${req.path} from ${req.ip}`);
    next();
  });
  app.use(express.json());

  // MCP request handler
  async function handleMcpRequest(req: Request, res: Response): Promise<void> {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    console.log(`[http] ${req.method} /mcp session=${sessionId ?? "none"} (active sessions: ${transports.size})`);

    // For GET requests (SSE stream), route to the existing session
    if (req.method === "GET") {
      if (sessionId && transports.has(sessionId)) {
        const transport = transports.get(sessionId)!;
        await transport.handleRequest(req, res);
        return;
      }
      console.warn(`[http] GET with unknown/missing session: ${sessionId ?? "none"}`);
      res.status(400).json({ error: "No valid session for SSE stream" });
      return;
    }

    // For POST requests, check for existing session
    if (req.method === "POST") {
      if (sessionId && transports.has(sessionId)) {
        const transport = transports.get(sessionId)!;
        await transport.handleRequest(req, res, req.body);
        return;
      }

      // Stale session ID - tell client to re-initialize
      if (sessionId) {
        console.warn(`[http] POST with stale session: ${sessionId}, returning 404`);
        res.status(404).json({ error: "Session not found" });
        return;
      }

      // No session header - new connection, create transport
      console.log(`[http] Creating new session`);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (newSessionId) => {
          console.log(`[http] Session initialized: ${newSessionId}`);
          transports.set(newSessionId, transport);
        },
        onsessionclosed: (closedSessionId) => {
          console.log(`[http] Session closed: ${closedSessionId}`);
          transports.delete(closedSessionId);
        },
      });

      const mcpServer = createMcpServer(config);
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    // For DELETE requests (session termination)
    if (req.method === "DELETE") {
      if (sessionId && transports.has(sessionId)) {
        console.log(`[http] Deleting session: ${sessionId}`);
        const transport = transports.get(sessionId)!;
        await transport.handleRequest(req, res);
        return;
      }
      console.warn(`[http] DELETE for unknown session: ${sessionId ?? "none"}`);
      res.status(404).json({ error: "Session not found" });
      return;
    }

    res.status(405).json({ error: "Method not allowed" });
  }

  // HMAC time-bucket token validation
  function isValidToken(token: string): boolean {
    for (const offset of [0, -1]) {
      const bucket = Math.floor(Date.now() / config.tokenBucketMs) + offset;
      const expected = createHmac("sha256", config.apiKey)
        .update(String(bucket))
        .digest("hex");
      if (token === expected) return true;
    }
    return false;
  }

  // Bearer token auth middleware (for Claude.ai OAuth flow)
  function validateBearer(
    req: Request,
    res: Response,
    next: () => void
  ): void {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const token = auth.slice(7);
    if (!isValidToken(token)) {
      console.warn(`[http] Unauthorized Bearer request from ${req.ip}: invalid token`);
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  }

  // MCP endpoint with Bearer auth (used by Claude.ai after OAuth)
  app.all("/mcp", validateBearer, handleMcpRequest);

  // Health check
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  const scheduler = new Scheduler(db, config);

  const server = app.listen(config.port, () => {
    console.log(`[server] Listening on port ${config.port}`);
    console.log(`[server] MCP endpoint: http://localhost:${config.port}/mcp`);
    scheduler.start();
  });
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`[server] Port ${config.port} is already in use`);
    } else {
      console.error(`[server] Failed to start: ${err.message}`);
    }
    process.exit(1);
  });

  process.on("SIGINT", async () => {
    console.log("[server] Shutting down (SIGINT)...");
    scheduler.stop();
    for (const transport of transports.values()) {
      await transport.close();
    }
    server.close();
    db.close();
    process.exit(0);
  });
}
