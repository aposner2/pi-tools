import { WebSocketServer, WebSocket } from "ws";
import { hostname } from "node:os";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ChatConfig, ChatMessage, Peer } from "./types";
import { appendHistory } from "./history";

const HEARTBEAT_MS = 30_000;
const MAX_MSG_LEN = 4000;

let wss: WebSocketServer | null = null;
let peers = new Map<string, Peer>();
let piRef: ExtensionAPI | null = null;
let ctxRef: ExtensionContext | null = null;
let configRef: ChatConfig | null = null;

// Message event hooks for external subscribers (e.g., chat panel)
const messageListeners = new Set<(msg: ChatMessage) => void>();

export function onMessage(callback: (msg: ChatMessage) => void): void {
  messageListeners.add(callback);
}

export function notifyMessage(msg: ChatMessage): void {
  messageListeners.forEach((cb) => cb(msg));
}

export function startServer(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  config: ChatConfig
): boolean {
  if (wss) return true;
  piRef = pi;
  ctxRef = ctx;
  configRef = config;

  try {
    wss = new WebSocketServer({ port: config.port });
  } catch {
    ctx.ui.notify(`pi-chat: failed to bind port ${config.port}`, "error");
    return false;
  }

  ctx.ui.notify(`pi-chat: listening on :${config.port}`, "info");

  // Expose config for tools/panel
  configRef = config;

  wss.on("connection", handleConnection);

  setInterval(() => {
    if (!wss) return clearInterval(0);
    wss.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    });
  }, HEARTBEAT_MS);

  return true;
}

function handleConnection(ws: WebSocket, req: { socket?: { remoteAddress?: string } }): void {
  const addr = req.socket?.remoteAddress || "unknown";

  // Send handshake
  ws.send(JSON.stringify({
    type: "handshake",
    from: configRef?.agentId,
    fromHost: hostname(),
    port: configRef?.port,
  }));

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString()) as ChatMessage;
      registerPeer(addr, msg.from);
      appendHistory(
        configRef?.historyPath || "",
        { from: msg.from, text: msg.text, timestamp: msg.timestamp, direction: "inbound" },
        configRef?.maxHistory || 500
      );
      // Notify chat panel of new message
      notifyMessage(msg);
      const prefix = msg.from ? `[chat from ${msg.from}]` : "[chat]";
      piRef?.sendUserMessage(`${prefix} ${msg.text}`, { deliverAs: "followUp" });
    } catch {
      // ignore malformed
    }
  });

  ws.on("close", () => {
    peers.delete(addr);
    ctxRef?.ui?.notify(`pi-chat: peer disconnected (${addr})`, "info");
  });
}

function registerPeer(addr: string, id: string): void {
  if (!peers.has(addr)) {
    peers.set(addr, { id, host: addr, port: 0, since: Date.now() });
    ctxRef?.ui?.notify(`pi-chat: ${id} connected`, "info");
  }
}

export function getPeers(): Map<string, Peer> {
  return peers;
}

export function getServer(): WebSocketServer | null {
  return wss;
}

export function stopServer(): void {
  if (wss) {
    wss.close();
    wss = null;
    peers.clear();
  }
  piRef = null;
  ctxRef = null;
  configRef = null;
}

export function broadcast(payload: string): void {
  if (!wss) return;
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  });
}
