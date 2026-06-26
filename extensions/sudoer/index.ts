/**
 * Pi Sudoer Extension
 *
 * Lets an AI coding agent run `sudo` commands without requiring passwordless
 * sudo in /etc/sudoers. Uses a two-step flow:
 *   1. LLM calls `sudo_auth()` to authenticate (shows masked TUI dialog)
 *   2. Subsequent `sudo` commands use the cached password automatically
 *
 * This avoids blocking on inline prompts and works cleanly in any mode.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder, isToolCallEventType } from "@earendil-works/pi-coding-agent";
import {
  Container,
  Text,
  type Component,
  type Focusable,
  CURSOR_MARKER,
  matchesKey,
  Key,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";

// ─── Configuration ───────────────────────────────────────────────────────────

interface SudoerConfig {
  confirmDangerousCommands: boolean;
  dangerousPatterns: string[];
  passwordTimeout: number;
  autoCache: boolean;
  maxPasswordAttempts: number;
}

const DEFAULT_CONFIG: SudoerConfig = {
  confirmDangerousCommands: true,
  dangerousPatterns: [
    "rm -rf",
    "mkfs",
    "dd if=",
    ": > ",
    "chmod -R 777",
    "userdel",
    "passwd",
    "apt purge",
    "systemctl stop",
    "iptables -F",
  ],
  passwordTimeout: 15,
  autoCache: true,
  maxPasswordAttempts: 3,
};

function loadConfig(cwd: string): SudoerConfig {
  // Try extension directory config first (same dir as index.ts)
  // Then global, then project-local, then defaults
  const extDirPath = path.join(__dirname, "config.json");
  const globalPath = path.join(os.homedir(), ".pi", "agent", "extensions", "sudoer", "config.json");
  const projectPath = path.join(cwd, ".pi", "extensions", "sudoer", "config.json");

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

// ─── Password State (per-host cache) ────────────────────────────────────────

interface CachedEntry {
  password: string;
  timestamp: number;
}

const passwordCache = new Map<string, CachedEntry>();

function getHostKey(): string {
  return os.hostname();
}

/** Extract the target host from commands like `ssh hostX "sudo ..."` or `sudo ssh hostX`. */
function extractTargetHost(command: string): string | null {
  // Match patterns: ssh <host>, ssh -l user <host>, ssh user@host, ssh <ip>
  const match = command.match(/\bssh\s+(?:-[a-zA-Z]+\s+)*(?:(?:-l\s+\S+\s+)?)?(?:\S+@)?(\S+)/);
  if (match) {
    // Filter out flags, quotes, and common non-host tokens
    const candidate = match[1].replace(/["']/g, "");
    if (!candidate.startsWith("-") && !candidate.includes(":") || /^\d+\.\d+/.test(candidate)) {
      return candidate;
    }
  }
  return null;
}

function getHostForCommand(command: string): string {
  // If the command involves SSH to a remote host, use that as the key.
  // Otherwise use local hostname.
  const target = extractTargetHost(command);
  if (target) return target;
  return getHostKey();
}

function isPasswordValid(config: SudoerConfig, host?: string): boolean {
  const key = host || getHostKey();
  const entry = passwordCache.get(key);
  if (!entry) return false;
  const ageMinutes = (Date.now() - entry.timestamp) / 60000;
  return ageMinutes < config.passwordTimeout;
}

function getCachedPassword(host?: string): string | null {
  const key = host || getHostKey();
  const entry = passwordCache.get(key);
  if (!entry) return null;
  return entry.password;
}

function setCachedPassword(password: string, host?: string): void {
  const key = host || getHostKey();
  passwordCache.set(key, { password, timestamp: Date.now() });
}

function clearPassword(host?: string): void {
  if (host) {
    passwordCache.delete(host);
  } else {
    passwordCache.clear();
  }
}

function isSudoAuthFailure(output: string): boolean {
  if (!output) return false;
  const lower = output.toLowerCase();
  return (
    lower.includes("sudo: 1 incorrect password attempt") ||
    lower.includes("sudo: 2 incorrect password attempts") ||
    lower.includes("sudo: 3 incorrect password attempts") ||
    lower.includes("sudo: 1 incorrect password attempt") ||
    lower.includes("sorry, try again") ||
    lower.includes("incorrect password attempt") ||
    lower.includes("not in the sudoers file") ||
    lower.includes("authentication failure")
  );
}

// ─── Password Verification ──────────────────────────────────────────────────

function verifyPassword(password: string): boolean {
  try {
    const escaped = password.replace(/'/g, "'\\''");
    const testCmd = `echo '${escaped}' | sudo -S -k echo "ok" 2>&1`;
    const result = fs.execSync(testCmd, { encoding: "utf-8", timeout: 10000 });
    return result.trim() === "ok";
  } catch {
    return false;
  }
}

// ─── MaskedInput Component ───────────────────────────────────────────────────

class MaskedInput implements Component, Focusable {
  private value: string = "";
  private cursorPos: number = 0;
  private _focused: boolean = false;

  public onAccept?: (value: string) => void;
  public onCancel?: () => void;

  get focused(): boolean {
    return this._focused;
  }

  set focused(v: boolean) {
    this._focused = v;
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.enter)) {
      this.onAccept?.(this.value);
      return;
    }
    if (matchesKey(data, Key.escape)) {
      this.onCancel?.();
      return;
    }
    if (matchesKey(data, Key.backspace)) {
      if (this.cursorPos > 0) {
        this.value = this.value.slice(0, this.cursorPos - 1) + this.value.slice(this.cursorPos);
        this.cursorPos--;
      } else if (this.cursorPos === 0 && this.value.length > 0) {
        // also delete first char if at start
        this.value = this.value.slice(1);
      }
      return;
    }
    if (matchesKey(data, Key.delete)) {
      if (this.cursorPos < this.value.length) {
        this.value = this.value.slice(0, this.cursorPos) + this.value.slice(this.cursorPos + 1);
      }
      return;
    }
    if (matchesKey(data, Key.left)) {
      if (this.cursorPos > 0) this.cursorPos--;
      return;
    }
    if (matchesKey(data, Key.right)) {
      if (this.cursorPos < this.value.length) this.cursorPos++;
      return;
    }
    if (matchesKey(data, Key.home)) {
      this.cursorPos = 0;
      return;
    }
    if (matchesKey(data, Key.end)) {
      this.cursorPos = this.value.length;
      return;
    }

    // Printable characters (char code >= 32)
    if (data.length === 1 && data.charCodeAt(0) >= 32) {
      this.value = this.value.slice(0, this.cursorPos) + data + this.value.slice(this.cursorPos);
      this.cursorPos++;
    }
  }

  render(width: number): string[] {
    const masked = "*".repeat(this.value.length);
    const beforeCursor = masked.slice(0, this.cursorPos);
    const atCursor = this.cursorPos < this.value.length ? "*" : " ";
    const afterCursor = masked.slice(this.cursorPos + 1);
    const marker = this.focused ? CURSOR_MARKER : "";

    const line = ` ${beforeCursor}${marker}\x1b[7m${atCursor}\x1b[27m${afterCursor} `;
    const padded = truncateToWidth(line, width);
    return [padded];
  }

  invalidate(): void {}
}

// ─── Password Dialog ─────────────────────────────────────────────────────────

async function promptPassword(
  ctx: ExtensionContext,
  host?: string,
): Promise<string | null> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("Sudoer: cannot prompt for password in non-TUI mode", "warning");
    return null;
  }

  const targetHost = host || os.hostname();

  return ctx.ui.custom<string | null>(
    (tui, theme, _keybindings, done) => {
      const container = new Container();

      // Top border
      container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

      // Title
      container.addChild(new Text(theme.fg("accent", theme.bold("Sudoer")), 1, 0));

      // Hostname
      const hostLabel = targetHost === os.hostname() ? "local" : `remote (${targetHost})`;
      container.addChild(new Text(`Host: ${hostLabel}`, 1, 0));

      // Prompt
      container.addChild(new Text("Enter sudo password:", 1, 0));

      // Masked input
      const maskedInput = new MaskedInput();
      maskedInput.focused = true;

      maskedInput.onAccept = (password: string) => {
        done(password);
      };
      maskedInput.onCancel = () => {
        done(null);
      };

      container.addChild(maskedInput);

      // Help text
      container.addChild(new Text(theme.fg("dim", "enter submit \u2022 esc cancel"), 1, 0));

      // Bottom border
      container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

      return {
        render(w: number) {
          return container.render(w);
        },
        invalidate() {
          container.invalidate();
        },
        handleInput(data: string) {
          maskedInput.handleInput(data);
          tui.requestRender();
        },
      };
    },
    { overlay: true },
  );
}

// ─── Prompt + Verify (up to maxPasswordAttempts) ─────────────────────────────

async function promptAndVerify(
  ctx: ExtensionContext,
  config: SudoerConfig,
  host?: string,
): Promise<string | null> {
  const maxAttempts = config.maxPasswordAttempts;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const password = await promptPassword(ctx, host);
    if (!password) return null; // user cancelled

    if (verifyPassword(password)) {
      setCachedPassword(password, host);
      ctx.ui.setStatus("sudoer", ctx.ui.theme.fg("success", `sudoer authenticated (${host || getHostKey()})`));
      return password;
    }

    const remaining = maxAttempts - attempt;
    if (remaining > 0) {
      ctx.ui.notify(`Password incorrect — ${remaining} attempt(s) remaining`, "warning");
    }
  }

  // All attempts exhausted
  clearPassword(host);
  ctx.ui.notify("Max password attempts reached", "error");
  ctx.ui.setStatus("sudoer", ctx.ui.theme.fg("error", `sudoer locked (${host || getHostKey()}) — ask user`));
  return null;
}

// ─── Dangerous Command Check ─────────────────────────────────────────────────

function isDangerousCommand(
  command: string,
  patterns: string[],
): boolean {
  return patterns.some((pattern) => command.includes(pattern));
}

// ─── Command Rewriting ───────────────────────────────────────────────────────

function rewriteSudoCommand(command: string, password: string): string {
  // Escape single quotes in password for shell safety
  const escapedPassword = password.replace(/'/g, "'\\''");
  // Replace 'sudo' with 'sudo -S -k' and append here-string for password
  const rewritten = command.replace(/\bsudo\b/, "sudo -S -k");
  return `${rewritten} <<< '${escapedPassword}'`;
}

// ─── Auth Required Message ──────────────────────────────────────────────────

function authRequiredMessage(host: string): string {
  return `Sudo requires authentication for host "${host}".\nCall sudo_auth() first, then retry this command.`;
}

// ─── Main Extension ──────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  let config: SudoerConfig = { ...DEFAULT_CONFIG };

  // Load config on session start
  pi.on("session_start", async (_event, ctx) => {
    config = loadConfig(ctx.cwd);
    clearPassword();
    ctx.ui.setStatus("sudoer", ctx.ui.theme.fg("muted", "sudoer ready"));
  });

  // Clear password on session shutdown
  pi.on("session_shutdown", async () => {
    clearPassword();
  });

  // Intercept bash tool calls containing sudo
  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return;

    const command = event.input.command;
    if (!command || !/\bsudo\b/.test(command)) return;

    // Determine the host key for this command
    const hostKey = getHostForCommand(command);

    // If no valid password cached, tell LLM to call sudo_auth() first
    if (!isPasswordValid(config, hostKey)) {
      return { block: true, reason: authRequiredMessage(hostKey) };
    }

    // Dangerous command confirmation
    if (config.confirmDangerousCommands && isDangerousCommand(command, config.dangerousPatterns)) {
      const ok = await ctx.ui.confirm(
        "Dangerous Sudo Command",
        `This command matches a dangerous pattern:\n${command}\n\nAllow execution?`,
      );
      if (!ok) {
        return { block: true, reason: "Dangerous sudo command blocked by user" };
      }
    }

    // Rewrite command to use sudo -S with stdin password
    const password = getCachedPassword(hostKey)!;
    event.input.command = rewriteSudoCommand(command, password);
  });

  // Check tool results for sudo authentication failures
  pi.on("tool_result", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return;

    const content = event.content;
    if (!content || !Array.isArray(content)) return;

    // Check if this was a sudo command that failed
    const output = content.map((c: any) => c.text || "").join("\n");
    if (!/\bsudo\b/.test(output) && !/\bsudo\b/.test(event.input?.command || "")) return;

      // Check for sudo authentication failure — clear the relevant host entry
      if (isSudoAuthFailure(output)) {
        const failedHost = getHostForCommand(event.input?.command || "");
        clearPassword(failedHost);
        ctx.ui.notify(`Sudo password failed for ${failedHost} — cached password cleared`, "warning");
        ctx.ui.setStatus("sudoer", ctx.ui.theme.fg("warning", `sudoer password failed (${failedHost})`));
      }
  });

  // Register /sudo-password command (user-facing, still does inline prompting)
  pi.registerCommand("sudo-password", {
    description: "Set or clear the cached sudo password (optionally for a specific host)",
    handler: async (args, ctx) => {
      const trimmed = args?.trim();

      // Handle "clear [host]" — clears all if no host specified
      if (trimmed === "clear" || trimmed?.startsWith("clear ")) {
        const targetHost = trimmed === "clear" ? undefined : trimmed.slice(6).trim() || undefined;
        clearPassword(targetHost);
        ctx.ui.notify(`Sudo password cleared${targetHost ? ` for ${targetHost}` : " (all hosts)"}`, "info");
        ctx.ui.setStatus("sudoer", ctx.ui.theme.fg("muted", "sudoer ready"));
        return;
      }

      // If args provided as a hostname, prompt for that host specifically
      const targetHost = trimmed || undefined;

      // Prompt for password (with verification loop)
      const password = await promptAndVerify(ctx, config, targetHost);
      if (password) {
        ctx.ui.notify(`Sudo password cached${targetHost ? ` for ${targetHost}` : ""}`, "success");
      } else {
        ctx.ui.notify("Password not set or failed verification", "warning");
      }
    },
  });

  // Register sudo_auth tool — authenticates and caches the password.
  // The LLM calls this ONCE before running any sudo commands.
  pi.registerTool({
    name: "sudo_auth",
    label: "Sudo Auth",
    description:
      "Authenticate for sudo access. Shows a masked password dialog, verifies the password, and caches it for future sudo commands. Call this once before running any sudo commands.",
    parameters: Type.Object({
      host: Type.Optional(Type.String({
        description: "Optional hostname to authenticate for (defaults to local machine)",
      })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const targetHost = params.host || undefined;

      // Already authenticated? Let user know.
      if (isPasswordValid(config, targetHost)) {
        const hostLabel = targetHost || getHostKey();
        return {
          content: [
            {
              type: "text",
              text: `Already authenticated for "${hostLabel}". You can run sudo commands directly.`,
            },
          ],
          details: {},
        };
      }

      // Prompt + verify (up to maxPasswordAttempts)
      const password = await promptAndVerify(ctx, config, targetHost);
      if (password) {
        const hostLabel = targetHost || getHostKey();
        return {
          content: [
            {
              type: "text",
              text: `Authenticated for "${hostLabel}". Password cached for ${config.passwordTimeout} minutes. You can now run sudo commands directly.`,
            },
          ],
          details: {},
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `Authentication failed or cancelled. Please try again with sudo_auth().`,
          },
        ],
        details: {},
      };
    },
  });

  // Register sudo_run tool (legacy — delegates to bash intercept after auth check)
  pi.registerTool({
    name: "sudo_run",
    label: "Sudo Run",
    description:
      "Run a command with sudo privileges. If not authenticated, you must call sudo_auth() first.",
    parameters: Type.Object({
      command: Type.String({
        description: "The command to run with sudo (without the 'sudo' prefix)",
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const cmd = params.command;
      const fullCommand = `sudo ${cmd}`;

      // Check if authenticated
      const hostKey = getHostForCommand(fullCommand);
      if (!isPasswordValid(config, hostKey)) {
        return {
          content: [
            {
              type: "text",
              text: authRequiredMessage(hostKey),
            },
          ],
          details: {},
        };
      }

      // Dangerous command check
      if (config.confirmDangerousCommands && isDangerousCommand(fullCommand, config.dangerousPatterns)) {
        const ok = await ctx.ui.confirm(
          "Dangerous Sudo Command",
          `This command matches a dangerous pattern:\n${fullCommand}\n\nAllow execution?`,
        );
        if (!ok) {
          return {
            content: [
              {
                type: "text",
                text: "Dangerous sudo command blocked by user.",
              },
            ],
            details: {},
          };
        }
      }

      // Return the sudo command for the LLM to execute via bash.
      // The bash tool_call handler will intercept and rewrite it with sudo -S -k.
      return {
        content: [
          {
            type: "text",
            text: `Execute this via the bash tool:\n${fullCommand}`,
          },
        ],
        details: {},
      };
    },
  });
}
