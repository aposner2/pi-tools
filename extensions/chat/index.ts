import { hostname } from "node:os";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { loadConfig } from "./config";
import { startServer, stopServer, getPeers, onMessage, broadcast } from "./server";
import { startDiscovery, stopDiscovery } from "./discovery";
import { disconnectAll, tryConnectToExisting, setClientConfig } from "./client";
import { registerTools, setConfig, setIsServer } from "./tools";
import { appendHistory } from "./history";
import { createChatPanel } from "./chat-panel";
import type { OverlayHandle } from "@earendil-works/pi-tui";

let panelHandle: OverlayHandle | null = null;
let tuiRef: TUI | null = null;
let configRef: ReturnType<typeof loadConfig> | null = null;
let renderInterval: ReturnType<typeof setInterval> | null = null;
let isServer: boolean = false;

export default function (pi: ExtensionAPI) {
  let config = loadConfig(process.cwd());
  setConfig(config);
  configRef = config;

  pi.on("session_start", async (_event, ctx) => {
    registerTools(pi);

    // Leader election: try to connect to an existing server first.
    // If nothing is listening, become the server ourselves.
    const connected = await tryConnectToExisting(config);
    if (connected) {
      isServer = false;
      setClientConfig(config);
      ctx.ui.notify(`pi-chat: connected to existing server on :${config.port}`, "info");
    } else {
      isServer = true;
      startServer(pi, ctx, config);
      ctx.ui.notify(`pi-chat: no server found — started server on :${config.port}`, "info");
    }
    setIsServer(isServer);

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
    if (isServer) {
      stopServer();
    }
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
        `Chat: ${count} peer(s) on port ${config.port} (role: ${isServer ? "server" : "client"})`,
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
          // Send message — route depends on whether we're the server or a client
          const msg = {
            from: configRef!.agentId,
            fromHost: hostname(),
            text: message,
            timestamp: Date.now(),
          };

          if (isServer) {
            broadcast(JSON.stringify(msg));
          } else {
            // Import dynamically to avoid circular deps
            const { sendToPeer } = require("./client");
            sendToPeer("127.0.0.1", configRef!.port, msg);
          }

          // Save to history
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
