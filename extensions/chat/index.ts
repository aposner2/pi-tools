import { hostname } from "node:os";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { loadConfig } from "./config";
import { startServer, stopServer, getPeers, onMessage, broadcast } from "./server";
import { startDiscovery, stopDiscovery } from "./discovery";
import { disconnectAll } from "./client";
import { registerTools, setConfig } from "./tools";
import { appendHistory } from "./history";
import { createChatPanel } from "./chat-panel";
import type { OverlayHandle } from "@earendil-works/pi-tui";

let panelHandle: OverlayHandle | null = null;
let tuiRef: TUI | null = null;
let configRef: ReturnType<typeof loadConfig> | null = null;
let renderInterval: ReturnType<typeof setInterval> | null = null;

export default function (pi: ExtensionAPI) {
  let config = loadConfig(process.cwd());
  setConfig(config);
  configRef = config;

  pi.on("session_start", async (_event, ctx) => {
    registerTools(pi);
    startServer(pi, ctx, config);
    startDiscovery(config);

    // Subscribe to incoming messages for chat panel updates
    onMessage((msg) => {
      if (panelHandle && tuiRef) {
        tuiRef.requestRender();
      }
    });
  });

  pi.on("session_shutdown", async () => {
    if (panelHandle) {
      panelHandle.hide();
      panelHandle = null;
    }
    if (renderInterval) {
      clearInterval(renderInterval);
      renderInterval = null;
    }
    stopServer();
    stopDiscovery();
    disconnectAll();
  });

  // Register shortcut to toggle chat panel
  pi.registerCommand("chat_toggle", {
    description: "Toggle A2A chat panel (Ctrl+Shift+C)",
    handler: async (_args, ctx) => {
      await toggleChatPanel(ctx);
    },
  });

  pi.registerCommand("chat", {
    description: "Show A2A chat status and connected peers",
    handler: async (_args, ctx) => {
      const count = getPeers().size;
      ctx.ui.notify(
        `Chat: ${count} peer(s) on port ${config.port}`,
        count > 0 ? "info" : "warning"
      );
      if (count > 0) {
        const lines = Array.from(getPeers().values())
          .map((p) => `  ${p.id} @ ${p.host}`);
        ctx.ui.setWidget("pi-chat", [
          `pi-chat — ${count} peer(s):`,
          ...lines,
        ]);
      }
    },
  });
}

async function toggleChatPanel(ctx: ExtensionContext): Promise<void> {
  // If panel is already open, close it
  if (panelHandle) {
    panelHandle.hide();
    panelHandle = null;
    return;
  }

  // Open chat panel as overlay
  await ctx.ui.custom(
    (tui, theme, _keybindings, done) => {
      tuiRef = tui;

      const panel = createChatPanel(
        theme,
        configRef!,
        ctx,
        (message: string) => {
          // Send message via broadcast
          const msg = {
            from: configRef!.agentId,
            fromHost: hostname(),
            text: message,
            timestamp: Date.now(),
          };
          broadcast(JSON.stringify(msg));
          // Also save to history
          appendHistory(
            configRef!.historyPath,
            { from: configRef!.agentId, text: message, timestamp: Date.now(), direction: "outbound" },
            configRef!.maxHistory
          );
          // Add to panel display
          panel.addMessage({
            from: configRef!.agentId,
            text: message,
            timestamp: Date.now(),
            direction: "outbound",
          });
        },
        () => {
          done(undefined);
          panelHandle = null;
        }
      );

      // Update peer count periodically
      renderInterval = setInterval(() => {
        const count = getPeers().size;
        panel.setPeerCount(count);
        tui.requestRender();
      }, 5000);

      return panel;
    },
    {
      overlay: true,
      overlayOptions: {
        anchor: "right-center",
        width: "40%",
        maxHeight: "80%",
        margin: 1,
      },
      onHandle: (handle) => {
        panelHandle = handle;
      },
    }
  );
}
