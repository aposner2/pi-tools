/**
 * Hostname Badge Extension
 *
 * Shows a persistent hostname badge above the input editor so you always know
 * which machine you're running on. Useful when managing multiple machines via
 * PI WEB, SSH, or remote sessions.
 *
 * Configurable via config.json (same directory, or ~/.pi/agent/extensions/hostname-badge/):
 *
 *   {
 *     "enabled": true,
 *     "showModel": true
 *   }
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// ─── Configuration ───────────────────────────────────────────────────────────

interface HostnameBadgeConfig {
  enabled: boolean;
  showModel: boolean;
}

const DEFAULT_CONFIG: HostnameBadgeConfig = {
  enabled: true,
  showModel: true,
};

function loadConfig(cwd: string): HostnameBadgeConfig {
  const extDirPath = path.join(__dirname, "config.json");
  const globalPath = path.join(os.homedir(), ".pi", "agent", "extensions", "hostname-badge", "config.json");
  const projectPath = path.join(cwd, ".pi", "extensions", "hostname-badge", "config.json");

  const paths = [extDirPath, globalPath, projectPath];
  for (const p of paths) {
    if (fs.existsSync(p)) {
      try {
        const content = fs.readFileSync(p, "utf-8");
        return { ...DEFAULT_CONFIG, ...JSON.parse(content) };
      } catch {
        // fall through
      }
    }
  }
  return { ...DEFAULT_CONFIG };
}

// ─── Main Extension ──────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  let config: HostnameBadgeConfig = { ...DEFAULT_CONFIG };

  pi.on("session_start", async (_event, ctx) => {
    config = loadConfig(ctx.cwd);

    if (!config.enabled) return;

    const hostname = os.hostname();

    // Widget above editor — re-renders on model changes via the render callback
    ctx.ui.setWidget("hostname-badge", (_tui, theme) => {
      return {
        render: () => {
          const modelInfo = config.showModel && ctx.model
            ? ` · ${ctx.model.id}`
            : "";
          return [theme.fg("accent", `[${hostname}]${modelInfo}`)];
        },
        invalidate: () => {},
      };
    });
  });

  pi.on("session_shutdown", async () => {
    // Widget is auto-cleared on session end, but be explicit
  });

  // Register /hostname command to toggle visibility
  pi.registerCommand("hostname", {
    description: "Toggle the hostname badge above the input editor",
    handler: async (_args, ctx) => {
      if (config.enabled) {
        config.enabled = false;
        ctx.ui.setWidget("hostname-badge", undefined);
        ctx.ui.notify("Hostname badge hidden", "info");
      } else {
        config.enabled = true;
        const hostname = os.hostname();
        ctx.ui.setWidget("hostname-badge", (_tui, theme) => {
          return {
            render: () => {
              const modelInfo = config.showModel && ctx.model
                ? ` · ${ctx.model.id}`
                : "";
              return [theme.fg("accent", `[${hostname}]${modelInfo}`)];
            },
            invalidate: () => {},
          };
        });
        ctx.ui.notify("Hostname badge shown", "info");
      }
    },
  });
}
