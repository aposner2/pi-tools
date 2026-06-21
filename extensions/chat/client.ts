import WebSocket from "ws";
import type { ChatConfig, ChatMessage } from "./types";
import { appendHistory } from "./history";

interface RemotePeer {
  host: string;
  port: number;
  ws: WebSocket;
  connected: boolean;
}

const connections = new Map<string, RemotePeer>();
let configRef: ChatConfig | null = null;

export function setClientConfig(cfg: ChatConfig): void {
  configRef = cfg;
}

/**
 * Try to connect to an existing chat server.  Returns true if a server was
 * found and we connected successfully.
 */
export async function tryConnectToExisting(config: ChatConfig): Promise<boolean> {
  return connectToPeer("127.0.0.1", config.port, config);
}

async function connectToPeer(
  host: string,
  port: number,
  config: ChatConfig
): Promise<boolean> {
  const key = `${host}:${port}`;
  if (connections.has(key)) {
    const existing = connections.get(key)!;
    if (existing.connected) return true;
    existing.ws.close();
  }

  return new Promise((resolve) => {
    try {
      const ws = new WebSocket(`ws://${host}:${port}`);

      ws.on("open", () => {
        const entry: RemotePeer = { host, port, ws, connected: true };
        connections.set(key, entry);

        ws.on("message", (data) => {
          try {
            const msg = JSON.parse(data.toString()) as ChatMessage;
            appendHistory(
              config.historyPath,
              { from: msg.from, text: msg.text, timestamp: msg.timestamp, direction: "inbound" },
              config.maxHistory
            );
          } catch { /* ignore */ }
        });

        ws.on("close", () => {
          entry.connected = false;
        });

        resolve(true);
      });

      ws.on("error", () => resolve(false));
    } catch {
      resolve(false);
    }
  });
}

export function sendToPeer(host: string, port: number, msg: ChatMessage): boolean {
  const key = `${host}:${port}`;
  const peer = connections.get(key);
  if (!peer || !peer.connected) return false;
  try {
    peer.ws.send(JSON.stringify(msg));
    appendHistory(
      configRef?.historyPath || "",
      { from: msg.from, text: msg.text, timestamp: msg.timestamp, direction: "outbound" },
      configRef?.maxHistory || 500
    );
    return true;
  } catch {
    return false;
  }
}

export function disconnectAll(): void {
  connections.forEach((p) => p.ws.close());
  connections.clear();
}

export function getConnectionCount(): number {
  return connections.size;
}
