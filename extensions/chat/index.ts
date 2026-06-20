import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config";
import { startServer, stopServer, getPeers } from "./server";
import { startDiscovery, stopDiscovery } from "./discovery";
import { disconnectAll } from "./client";
import { registerTools, setConfig } from "./tools";

export default function (pi: ExtensionAPI) {
  let config = loadConfig(process.cwd());
  setConfig(config);

  pi.on("session_start", async (_event, ctx) => {
    registerTools(pi);
    startServer(pi, ctx, config);
    startDiscovery(config);
  });

  pi.on("session_shutdown", async () => {
    stopServer();
    stopDiscovery();
    disconnectAll();
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
