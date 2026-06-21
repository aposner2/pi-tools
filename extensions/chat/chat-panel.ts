import {
  Container,
  Text,
  Input,
  type Component,
  type Focusable,
  CURSOR_MARKER,
  matchesKey,
  Key,
  truncateToWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { HistoryEntry, ChatConfig } from "./types";
import { loadHistory } from "./history";
import { getDiscoveredPeers } from "./discovery";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChatPanelTheme {
  header: (s: string) => string;
  muted: (s: string) => string;
  accent: (s: string) => string;
  inbound: (s: string) => string;
  outbound: (s: string) => string;
  mention: (s: string) => string;
  scrollbar: (s: string) => string;
  inputLabel: (s: string) => string;
  border: (s: string) => string;
}

interface ChatPanelCallbacks {
  onSend: (message: string) => void;
  onClose: () => void;
}

// ─── Message Line Component ──────────────────────────────────────────────────

class MessageLine implements Component {
  private entry: HistoryEntry;
  private theme: ChatPanelTheme;
  private localAgentId: string;
  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(entry: HistoryEntry, theme: ChatPanelTheme, localAgentId: string) {
    this.entry = entry;
    this.theme = theme;
    this.localAgentId = localAgentId;
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }

    const dir = this.entry.direction === "inbound" ? "◀" : "▶";
    const dirColor = this.entry.direction === "inbound"
      ? this.theme.inbound(dir)
      : this.theme.outbound(dir);

    const t = new Date(this.entry.timestamp).toISOString().slice(11, 19);
    const sender = this.entry.from || "unknown";
    const isSelf = sender === this.localAgentId;

    // Build sender label with accent if it's a mention target
    let senderLabel = sender;
    if (isSelf) {
      senderLabel = this.theme.accent(sender);
    }

    const prefix = `${dirColor} [${t}] ${senderLabel}: `;
    const availableWidth = Math.max(width - prefix.length, 10);

    // Highlight #mentions in the message text
    const textLines = this.highlightMentions(this.entry.text, availableWidth);

    // Prepend prefix to first line
    const lines = [
      prefix + textLines[0],
      ...textLines.slice(1).map((l) => " ".repeat(prefix.length) + l),
    ];

    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  private highlightMentions(text: string, width: number): string[] {
    // Split on #mentions and apply accent color
    const parts: string[] = [];
    const regex = /#([a-zA-Z0-9_-]+)/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
      // Text before mention
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index));
      }
      // The mention itself
      parts.push(this.theme.mention(match[0]));
      lastIndex = match.index + match[0].length;
    }

    // Remaining text
    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }

    // Wrap respecting width
    return wrapTextWithAnsi(parts.join(""), width);
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }
}

// ─── Message List (scrollable) ───────────────────────────────────────────────

class MessageList implements Component {
  private messages: HistoryEntry[];
  private theme: ChatPanelTheme;
  private localAgentId: string;
  private scrollOffset: number;
  private visibleLines: number;
  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(messages: HistoryEntry[], theme: ChatPanelTheme, localAgentId: string) {
    this.messages = messages;
    this.theme = theme;
    this.localAgentId = localAgentId;
    this.scrollOffset = messages.length; // Start at bottom
    this.visibleLines = 10; // default, updated on render
  }

  setTheme(theme: ChatPanelTheme): void {
    this.theme = theme;
    this.invalidate();
  }

  addMessage(entry: HistoryEntry): void {
    this.messages.push(entry);
    this.scrollOffset = this.messages.length; // Auto-scroll to bottom
    this.invalidate();
  }

  setMessages(entries: HistoryEntry[]): void {
    this.messages = entries;
    this.scrollOffset = entries.length;
    this.invalidate();
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.up) && this.scrollOffset > 0) {
      this.scrollOffset--;
      this.invalidate();
    } else if (matchesKey(data, Key.down) && this.scrollOffset < this.messages.length) {
      this.scrollOffset++;
      this.invalidate();
    } else if (matchesKey(data, Key.pageUp)) {
      this.scrollOffset = Math.max(0, this.scrollOffset - this.visibleLines);
      this.invalidate();
    } else if (matchesKey(data, Key.pageDown)) {
      this.scrollOffset = Math.min(this.messages.length, this.scrollOffset + this.visibleLines);
      this.invalidate();
    } else if (matchesKey(data, Key.home)) {
      this.scrollOffset = 0;
      this.invalidate();
    } else if (matchesKey(data, Key.end)) {
      this.scrollOffset = this.messages.length;
      this.invalidate();
    }
  }

  render(width: number): string[] {
    // Build message lines
    const messageComponents: MessageLine[] = this.messages.map(
      (m) => new MessageLine(m, this.theme, this.localAgentId)
    );

    // Render all messages to get total line count
    const allLines: string[] = [];
    for (const comp of messageComponents) {
      allLines.push(...comp.render(width));
    }

    if (allLines.length === 0) {
      this.visibleLines = 10;
      return [this.theme.muted("  No messages yet")];
    }

    // Calculate visible area (leave 2 lines for scrollbar + spacing)
    this.visibleLines = Math.max(5, Math.floor((width * 0.1))); // rough estimate
    // We'll adjust based on actual render

    // Determine visible window
    const startIdx = Math.max(0, this.scrollOffset - this.visibleLines);
    const endIdx = Math.min(allLines.length, this.scrollOffset + 1);
    const visible = allLines.slice(startIdx, endIdx);

    // Add scrollbar indicator
    const totalLines = allLines.length;
    const pct = totalLines > 0 ? Math.round((this.scrollOffset / totalLines) * 100) : 0;
    const scrollBar = this.theme.scrollbar(`▼ ${this.scrollOffset}/${totalLines} (${pct}%)`);

    // Pad to fill visible area
    while (visible.length < this.visibleLines - 1) {
      visible.push("");
    }

    const lines = [...visible, scrollBar];
    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }
}

// ─── Chat Panel (main overlay component) ─────────────────────────────────────

class ChatPanel extends Container implements Focusable {
  private theme: ChatPanelTheme;
  private config: ChatConfig;
  private callbacks: ChatPanelCallbacks;
  private messageList: MessageList;
  private input: Input;
  private peerCount: number;
  private ctx: ExtensionContext | null;
  private discoveredPeers: Set<string>;

  private _focused: boolean = false;
  get focused(): boolean { return this._focused; }
  set focused(value: boolean) {
    this._focused = value;
    this.input.focused = value;
  }

  constructor(
    theme: Theme,
    config: ChatConfig,
    callbacks: ChatPanelCallbacks,
    ctx: ExtensionContext
  ) {
    super();
    this.theme = this.buildTheme(theme);
    this.config = config;
    this.callbacks = callbacks;
    this.ctx = ctx;
    this.peerCount = 0;
    this.discoveredPeers = getDiscoveredPeers();

    // Load history
    const history = loadHistory(config.historyPath, config.maxHistory);
    this.messageList = new MessageList(history, this.theme, config.agentId);
    this.addChild(this.messageList);

    // Separator line
    this.addChild(new Text(this.theme.border("─".repeat(40)), 0, 0));

    // Input field
    this.input = new Input();
    this.addChild(this.input);

    // Build the container with proper structure
    this.rebuild();
  }

  private buildTheme(theme: Theme): ChatPanelTheme {
    return {
      header: (s: string) => theme.fg("accent", s),
      muted: (s: string) => theme.fg("muted", s),
      accent: (s: string) => theme.fg("accent", s),
      inbound: (s: string) => theme.fg("success", s),
      outbound: (s: string) => theme.fg("dim", s),
      mention: (s: string) => theme.fg("accent", theme.bold(s)),
      scrollbar: (s: string) => theme.fg("dim", s),
      inputLabel: (s: string) => theme.fg("border", s),
      border: (s: string) => theme.fg("border", s),
    };
  }

  private rebuild(): void {
    this.clear();

    // Header
    const statusDot = this.peerCount > 0
      ? this.theme.header("●")
      : this.theme.muted("○");
    const headerText = `${statusDot} Chat — ${this.peerCount} peer(s) • ${this.config.agentId}`;
    this.addChild(new Text(this.theme.header(headerText), 0, 0));

    // Discovered peers list
    const peerList = Array.from(this.discoveredPeers);
    if (peerList.length > 0) {
      this.addChild(new Text(this.theme.muted(`  Peers:`), 0, 0));
      for (const peer of peerList) {
        this.addChild(new Text(this.theme.accent(`  • ${peer}`), 0, 0));
      }
    }

    // Separator
    this.addChild(new Text(this.theme.border("─".repeat(80)), 0, 0));

    // Message list (will be added via addChild in constructor)
    this.addChild(this.messageList);

    // Separator before input
    this.addChild(new Text(this.theme.border("─".repeat(80)), 0, 0));

    // Input
    this.addChild(this.input);
  }

  setPeerCount(count: number): void {
    this.peerCount = count;
    this.discoveredPeers = getDiscoveredPeers();
    this.invalidate();
  }

  addMessage(entry: HistoryEntry): void {
    this.messageList.addMessage(entry);
    this.invalidate();
  }

  setTheme(theme: Theme): void {
    this.theme = this.buildTheme(theme);
    this.messageList.setTheme(this.theme);
    this.invalidate();
  }

  handleInput(data: string): void {
    // If input has focus, let it handle the input
    if (this.input.focused) {
      this.input.handleInput(data);
      return;
    }

    // Handle panel-level keys
    if (matchesKey(data, Key.escape)) {
      this.callbacks.onClose();
      return;
    }

    // Pass to message list for scrolling
    this.messageList.handleInput(data);
  }

  override invalidate(): void {
    super.invalidate();
    this.rebuild();
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createChatPanel(
  theme: Theme,
  config: ChatConfig,
  ctx: ExtensionContext,
  onSend: (message: string) => void,
  onClose: () => void
): ChatPanel {
  return new ChatPanel(theme, config, { onSend, onClose }, ctx);
}

export type { ChatPanel };
