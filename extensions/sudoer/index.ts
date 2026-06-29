/**
 * Pi Sudoer Extension
 *
 * Lets an AI coding agent run `sudo` commands without requiring passwordless
 * sudo in /etc/sudoers. Uses a two-step flow:
 *   1. LLM calls `sudo_auth()` to authenticate (shows masked TUI dialog)
 *   2. Subsequent `sudo` commands use the cached password automatically
 *
 * Password delivery uses `spawn` + `sudo -S` (stdin piping) — no TTY required.
 */

import { spawn } from "node:child_process";
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
  const match = command.match(/\bssh\s+(?:-[a-zA-Z]+\s+)*(?:(?:-l\s+\S+\s+)?)?(?:\S+@)?(\S+)/);
  if (match) {
    const candidate = match[1].replace(/["']/g, "");
    if (!candidate.startsWith("-") && !candidate.includes(":") || /^\d+\.\d+/.test(candidate)) {
      return candidate;
    }
  }
  return null;
}

function getHostForCommand(command: string): string {
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

// ─── Command Execution (spawn + stdin piping — no TTY required) ──────────────

interface SudoExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Execute a sudo command by spawning a shell and piping the password via stdin. */
async function executeSudoCommand(
  command: string,
  password: string,
  timeoutMs = 30_000,
): Promise<SudoExecutionResult> {
  // Wrap with a shell function so nested sudo calls also read from stdin
  const wrappedCommand = [
    `sudo() { command sudo -S -p '' "$@"; }`,
    command,
  ].join("\n");

  return await new Promise((resolve) => {
    const child = spawn("/bin/sh", ["-lc", wrappedCommand], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf-8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf-8"); });

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: stderr || String(error), exitCode: 1 });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({ stdout, stderr: stderr || `Timed out after ${timeoutMs}ms`, exitCode: 124 });
        return;
      }
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    // Pipe password multiple times for compound commands with repeated sudo
    child.stdin.write(`${password}\n${password}\n${password}\n`);
    child.stdin.end();
  });
}

/** Verify a password by running `sudo -S -k echo ok` and piping the password via stdin. */
async function verifyPassword(password: string): Promise<boolean> {
  const result = await executeSudoCommand("sudo -S -k echo ok", password);
  return result.exitCode === 0 && (result.stdout + result.stderr).includes("ok");
}

function formatBashOutput(result: SudoExecutionResult): string {
  const parts: string[] = [];
  if (result.stdout.trim().length > 0) parts.push(result.stdout.trimEnd());
  if (result.stderr.trim().length > 0) parts.push(result.stderr.trimEnd());
  let output = parts.join("\n") || "(no output)";
  if (result.exitCode !== 0) {
    output += `\n\nCommand exited with code ${result.exitCode}`;
  }
  return output;
}

// ─── MaskedInput Component ───────────────────────────────────────────────────

class MaskedInput implements Component, Focusable {
  private value: string = "";
  private cursorPos: number = 0;
  private _focused: boolean = false;

  public onAccept?: (value: string) => void;
  public onCancel?: () => void;

  get focused(): boolean { return this._focused; }
  set focused(v: boolean) { this._focused = v; }

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

    // Accept printable characters — include multi-byte UTF-8 sequences.
    const isControl = [...data].every(c => {
      const code = c.charCodeAt(0);
      return code < 32 || code === 127;
    });
    if (!isControl && data.trim().length > 0) {
      this.value = this.value.slice(0, this.cursorPos) + data + this.value.slice(this.cursorPos);
      this.cursorPos += [...data].length;
    }
  }

  render(width: number): string[] {
    const masked = "•".repeat(this.value.length);
    const beforeCursor = masked.slice(0, this.cursorPos);
    const atCursor = this.cursorPos < this.value.length ? "•" : " ";
    const afterCursor = masked.slice(this.cursorPos + 1);
    const marker = this.focused ? CURSOR_MARKER : "";

    const line = ` ${beforeCursor}${marker}\x1b[7m${atCursor}\x1b[27m${afterCursor} `;
    return [truncateToWidth(line, width)];
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

      container.addChild(new DynamicBorder((s: string) => theme.fg("error", s)));
      container.addChild(new Text(theme.fg("error", theme.bold("Sudoer")), 1, 0));

      const hostLabel = targetHost === os.hostname() ? "local" : `remote (${targetHost})`;
      container.addChild(new Text(`Host: ${hostLabel}`, 1, 0));
      container.addChild(new Text("Enter sudo password:", 1, 0));

      const maskedInput = new MaskedInput();
      maskedInput.focused = true;
      maskedInput.onAccept = (password: string) => done(password);
      maskedInput.onCancel = () => done(null);
      container.addChild(maskedInput);

      container.addChild(new Text(theme.fg("dim", "enter submit • esc cancel"), 1, 0));
      container.addChild(new DynamicBorder((s: string) => theme.fg("error", s)));

      return {
        render(w: number) { return container.render(w); },
        invalidate() { container.invalidate(); },
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

    if (await verifyPassword(password)) {
      setCachedPassword(password, host);
      ctx.ui.setStatus("sudoer", ctx.ui.theme.fg("success", `sudoer authenticated (${host || getHostKey()})`));
      return password;
    }

    const remaining = maxAttempts - attempt;
    if (remaining > 0) {
      ctx.ui.notify(`Password incorrect — ${remaining} attempt(s) remaining`, "warning");
    }
  }

  clearPassword(host);
  ctx.ui.notify("Max password attempts reached", "error");
  ctx.ui.setStatus("sudoer", ctx.ui.theme.fg("error", `sudoer locked (${host || getHostKey()}) — ask user`));
  return null;
}

// ─── Dangerous Command Check ─────────────────────────────────────────────────

function isDangerousCommand(command: string, patterns: string[]): boolean {
  return patterns.some((pattern) => command.includes(pattern));
}

// ─── Auth Required Message ──────────────────────────────────────────────────

function authRequiredMessage(host: string): string {
  return `Sudo requires authentication for host "${host}".\nCall sudo_auth() first, then retry this command.`;
}

// ─── Main Extension ──────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  let config: SudoerConfig = { ...DEFAULT_CONFIG };

  // Captured sudo execution output keyed by tool call id.
  const sudoResults = new Map<string, SudoExecutionResult>();

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

  // Intercept bash tool calls containing sudo — execute via spawn + stdin piping
  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return;

    const command = event.input.command;
    if (!command || !/\bsudo\b/.test(command)) return;

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

    // Execute directly via spawn + stdin piping (no TTY required)
    const password = getCachedPassword(hostKey)!;
    ctx.ui.notify("Executing sudo command...", "info");
    const result = await executeSudoCommand(command, password);

    // Store result for injection in tool_result; replace bash with noop
    sudoResults.set(event.toolCallId, result);
    event.input.command = "true";
  });

  // Inject stored sudo results back into tool output
  pi.on("tool_result", async (event) => {
    if (!isToolCallEventType("bash", event)) return;

    const sudoResult = sudoResults.get(event.toolCallId);
    if (!sudoResult) return;
    sudoResults.delete(event.toolCallId);

    return {
      content: [{ type: "text", text: formatBashOutput(sudoResult) }],
      details: { sudoHandled: true, exitCode: sudoResult.exitCode },
      isError: sudoResult.exitCode !== 0,
    };
  });

  // Register /sudo-password command (user-facing)
  pi.registerCommand("sudo-password", {
    description: "Set or clear the cached sudo password (optionally for a specific host)",
    handler: async (args, ctx) => {
      const trimmed = args?.trim();

      if (trimmed === "clear" || trimmed?.startsWith("clear ")) {
        const targetHost = trimmed === "clear" ? undefined : trimmed.slice(6).trim() || undefined;
        clearPassword(targetHost);
        ctx.ui.notify(`Sudo password cleared${targetHost ? ` for ${targetHost}` : " (all hosts)"}`, "info");
        ctx.ui.setStatus("sudoer", ctx.ui.theme.fg("muted", "sudoer ready"));
        return;
      }

      const targetHost = trimmed || undefined;
      const password = await promptAndVerify(ctx, config, targetHost);
      if (password) {
        ctx.ui.notify(`Sudo password cached${targetHost ? ` for ${targetHost}` : ""}`, "success");
      } else {
        ctx.ui.notify("Password not set or failed verification", "warning");
      }
    },
  });

  // Register sudo_auth tool — authenticates and caches the password.
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

      if (isPasswordValid(config, targetHost)) {
        const hostLabel = targetHost || getHostKey();
        return {
          content: [{ type: "text", text: `Already authenticated for "${hostLabel}". You can run sudo commands directly.` }],
          details: {},
        };
      }

      const password = await promptAndVerify(ctx, config, targetHost);
      if (password) {
        const hostLabel = targetHost || getHostKey();
        return {
          content: [{ type: "text", text: `Authenticated for "${hostLabel}". Password cached for ${config.passwordTimeout} minutes. You can now run sudo commands directly.` }],
          details: {},
        };
      }

      return {
        content: [{ type: "text", text: `Authentication failed or cancelled. Please try again with sudo_auth().` }],
        details: {},
      };
    },
  });

  // Register sudo_run tool — executes directly via spawn + stdin piping.
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

      const hostKey = getHostForCommand(fullCommand);
      if (!isPasswordValid(config, hostKey)) {
        return {
          content: [{ type: "text", text: authRequiredMessage(hostKey) }],
          details: {},
        };
      }

      if (config.confirmDangerousCommands && isDangerousCommand(fullCommand, config.dangerousPatterns)) {
        const ok = await ctx.ui.confirm(
          "Dangerous Sudo Command",
          `This command matches a dangerous pattern:\n${fullCommand}\n\nAllow execution?`,
        );
        if (!ok) {
          return {
            content: [{ type: "text", text: "Dangerous sudo command blocked by user." }],
            details: {},
          };
        }
      }

      // Execute directly via spawn + stdin piping (no TTY required)
      const password = getCachedPassword(hostKey)!;
      ctx.ui.notify("Executing sudo command...", "info");
      const result = await executeSudoCommand(fullCommand, password);

      return {
        content: [{ type: "text", text: formatBashOutput(result) }],
        details: { exitCode: result.exitCode },
        isError: result.exitCode !== 0,
      };
    },
  });
}