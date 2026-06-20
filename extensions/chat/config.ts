import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { hostname } from "node:os";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import type { ChatConfig } from "./types";

const DEFAULT_PORT = 18790;
const CONFIG_FILE = "chat.json";

export function loadConfig(cwd: string): ChatConfig {
  const configDir = join(cwd, CONFIG_DIR_NAME);
  const configPath = join(configDir, CONFIG_FILE);

  const defaults: ChatConfig = {
    port: DEFAULT_PORT,
    agentId: hostname() || "pi-agent",
    allowedPeers: [],
    historyPath: join(configDir, "chat-history.jsonl"),
    maxHistory: 500,
  };

  if (!existsSync(configPath)) {
    mkdirSync(configDir, { recursive: true });
    saveConfig(configPath, defaults);
    return defaults;
  }

  try {
    const data = readFileSync(configPath, "utf-8");
    const cfg = JSON.parse(data) as Partial<ChatConfig>;
    return {
      port: cfg.port ?? defaults.port,
      agentId: cfg.agentId ?? defaults.agentId,
      allowedPeers: cfg.allowedPeers ?? defaults.allowedPeers,
      historyPath: cfg.historyPath ?? defaults.historyPath,
      maxHistory: cfg.maxHistory ?? defaults.maxHistory,
    };
  } catch {
    return defaults;
  }
}

export function saveConfig(path: string, config: ChatConfig): void {
  try {
    writeFileSync(path, JSON.stringify(config, null, 2), "utf-8");
  } catch {
    // non-fatal
  }
}
