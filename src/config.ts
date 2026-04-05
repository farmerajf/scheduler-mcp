import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

export type TransportMode = "stdio" | "http";

export interface PushoverConfig {
  appToken: string;
  userKey: string;
}

export interface Config {
  transport: TransportMode;
  port: number;
  apiKey: string;
  tokenBucketMs: number;
  schedulerIntervalMs: number;
  claudePath: string;
  pushover?: PushoverConfig;
}

const DEFAULT_CONFIG_PATH = "./config.json";

export function loadConfig(configPath?: string): Config {
  const resolvedPath = resolve(configPath || DEFAULT_CONFIG_PATH);

  if (!existsSync(resolvedPath)) {
    throw new Error(`Config file not found: ${resolvedPath}`);
  }

  const raw = readFileSync(resolvedPath, "utf-8");
  const config = JSON.parse(raw) as Partial<Config>;

  // Transport mode - can be overridden by env var or CLI arg
  const transportEnv = process.env.MCP_TRANSPORT as TransportMode | undefined;
  const transportArg = process.argv.includes("--stdio")
    ? "stdio"
    : undefined;

  config.transport = transportArg || transportEnv || config.transport || "http";

  if (config.transport !== "stdio" && config.transport !== "http") {
    throw new Error(
      `Invalid transport mode: ${config.transport}. Must be "stdio" or "http"`
    );
  }

  // Port and apiKey only required for HTTP mode
  if (config.transport === "http") {
    if (typeof config.port !== "number" || config.port <= 0) {
      throw new Error("Config must have a valid port number for HTTP mode");
    }

    if (typeof config.apiKey !== "string" || config.apiKey.length === 0) {
      throw new Error("Config must have a non-empty apiKey for HTTP mode");
    }
  } else {
    config.port = config.port || 0;
    config.apiKey = config.apiKey || "";
  }

  config.schedulerIntervalMs = config.schedulerIntervalMs || 30000;
  config.tokenBucketMs = config.tokenBucketMs || 3600000;
  config.claudePath = config.claudePath || "claude";

  // Validate pushover config if provided
  if (config.pushover) {
    if (
      typeof config.pushover.appToken !== "string" ||
      typeof config.pushover.userKey !== "string"
    ) {
      throw new Error(
        "Pushover config must have appToken and userKey strings"
      );
    }
  }

  return config as Config;
}
