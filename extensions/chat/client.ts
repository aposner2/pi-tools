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

export function connectToPeer(
  host: string,
  port: number,
  config: ChatConfig
): Promise<boolean> {
  const key = `${host}:${port}`;
  if (connections.has(key)) {
    const existing = connections.get(key)!;
    if (existing.connected) return Promise.resolve(true);
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
      configPath(),
      { from: msg.from, text: msg.text, timestamp: msg.timestamp, direction: "outbound" },
      500
    );
    return true;
  } catch {
    return false;
  }
}

function configPath(): string {
  // fallback; will be overridden by index.ts
  return "";
}

export function disconnectAll(): void {
  connections.forEach((p) => p.ws.close());
  connections.clear();
}

export function getConnectionCount(): number {
  return connections.size;
}
