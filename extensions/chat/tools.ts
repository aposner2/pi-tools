import { Type } from "typebox";
import { hostname } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ChatConfig, ChatMessage } from "./types";
import { getPeers, getServer, broadcast } from "./server";
import { loadHistory } from "./history";

let configRef: ChatConfig | null = null;

export function setConfig(cfg: ChatConfig): void {
  configRef = cfg;
}

export function registerTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "chat_send",
    label: "Chat Send",
    description: "Send a message to connected peer agents via A2A chat",
    promptSnippet: "Send messages to peer pi agents over WebSocket",
    parameters: Type.Object({
      message: Type.String({
        description: "The message to send (keep under 4000 chars)",
      }),
    }),
    async execute(_id, params) {
      const peers = getPeers();
      if (peers.size === 0) {
        return {
          content: [{ type: "text", text: "No peers connected." }],
        };
      }
      const msg: ChatMessage = {
        from: configRef?.agentId || hostname(),
        fromHost: hostname(),
        text: params.message,
        timestamp: Date.now(),
      };
      broadcast(JSON.stringify(msg));
      return {
        content: [{
          type: "text",
          text: `Sent to ${peers.size} peer(s): "${truncate(params.message, 80)}"`,
        }],
      };
    },
  });

  pi.registerTool({
    name: "chat_peers",
    label: "Chat Peers",
    description: "List connected peer agents in the A2A chat network",
    promptSnippet: "List connected peer pi agents",
    parameters: Type.Object({}),
    async execute() {
      const peers = getPeers();
      if (peers.size === 0) {
        return {
          content: [{
            type: "text",
            text: `No peers connected.\nAgent: ${configRef?.agentId}\nPort: ${configRef?.port}`,
          }],
        };
      }
      const list = Array.from(peers.values())
        .map((p) => `- ${p.id} (${p.host}) — ${Math.round((Date.now() - p.since) / 1000)}s ago`)
        .join("\n");
      return {
        content: [{ type: "text", text: `Connected peers:\n${list}` }],
      };
    },
  });

  pi.registerTool({
    name: "chat_history",
    label: "Chat History",
    description: "View recent chat message history",
    promptSnippet: "View recent A2A chat messages",
    parameters: Type.Object({
      limit: Type.Optional(
        Type.Number({ description: "Number of messages to show", default: 20 })
      ),
    }),
    async execute(_id, params) {
      const path = configRef?.historyPath || "";
      const limit = params.limit || 20;
      const entries = loadHistory(path, limit);
      if (entries.length === 0) {
        return { content: [{ type: "text", text: "No chat history." }] };
      }
      const lines = entries.map((e) => {
        const dir = e.direction === "inbound" ? "◀" : "▶";
        const t = new Date(e.timestamp).toISOString().slice(11, 19);
        return `${dir} [${t}] ${e.from}: ${truncate(e.text, 100)}`;
      });
      return {
        content: [{ type: "text", text: `Recent messages:\n${lines.join("\n")}` }],
      };
    },
  });
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
