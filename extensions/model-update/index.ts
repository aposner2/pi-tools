/**
 * Model Update Extension
 *
 * Commands:
 *   /model-update    - Query LM Studio for fresh model list and update models.json
 *   /model-config    - Interactive per-model configuration (reasoning, context window, etc.)
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, type SelectItem, SelectList, Text, Spacer, type SettingItem, SettingsList } from "@earendil-works/pi-tui";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";

// ─── Paths ───────────────────────────────────────────────────────────────────

const MODELS_JSON = path.join(os.homedir(), ".pi", "agent", "models.json");

// ─── Known Model Specs (from HuggingFace docs, verified Aug 2026) ──────────────
// Source URLs:
//   Qwen3.8-27B: https://huggingface.co/Qwen/Qwen3.8-27B
//   Qwen3-Coder-30B-A3B: https://huggingface.co/Qwen/Qwen3-Coder-30B-A3B-Instruct
//   Devstral-Small-2507: https://huggingface.co/mistralai/Devstral-Small-2507
//   Qwen2.5-VL-72B: https://huggingface.co/Qwen/Qwen2.5-VL-72B-Instruct

// Per-model reasoning_effort options (from official HuggingFace docs):
//   Qwen3.8-27B: xhigh (default), medium, low — https://huggingface.co/Qwen/Qwen3.8-27B
//   Qwen3.6 family: low, medium, high, xhigh (all accepted by LMS API)
//   Qwen3-Coder-30B-A3B: non-thinking only — no reasoning_effort support
//   Devstral-Small-2507: no thinking mode (Mistral lineage)

type ReasoningEffort = "low" | "medium" | "high" | "xhigh";

interface ModelSpec {
  reasoning?: boolean;
  input: ("text" | "image")[];
  contextWindow: number;
  maxTokens: number;
  displayName?: string;
  // Valid reasoning_effort values for this model (from official docs)
  reasoningEffortOptions?: ReasoningEffort[];
}

const KNOWN_SPECS: Record<string, ModelSpec> = {
  // ── Qwen3.8 family (newest) ─────────────────────────────────────
  // Official docs: reasoning_effort options are xhigh (default), medium, low
  "qwen/qwen3.8-27b": { displayName: "Qwen3.8-27B", reasoning: true, input: ["text", "image"], contextWindow: 262144, maxTokens: 81920, reasoningEffortOptions: ["xhigh", "medium", "low"] },

  // ── Qwen3.6 family (MTP + uncensored) ───────────────────────────
  // LMS API accepts all four values; xhigh tested and working
  "qwen3.6-27b-mtp": { displayName: "Qwen3.6-27B-MTP", reasoning: true, input: ["text", "image"], contextWindow: 262144, maxTokens: 81920, reasoningEffortOptions: ["xhigh", "high", "medium", "low"] },
  // Uncensored fine-tune of Qwen3.6 — supports thinking mode (default on)
  "qwen3.6-35b-a3b-uncensored-hauhaucs-aggressive": { displayName: "Qwen3.6-35B-A3B Uncensored", reasoning: true, input: ["text", "image"], contextWindow: 262144, maxTokens: 81920, reasoningEffortOptions: ["xhigh", "high", "medium", "low"] },

  // ── Qwen3-Coder (MoE) — non-thinking only per HF docs ───────────
  "qwen/qwen3-coder-30b": { displayName: "Qwen3-Coder-30B-A3B", reasoning: false, input: ["text"], contextWindow: 262144, maxTokens: 81920 },

  // ── Mistral Devstral (coding agent) — no thinking mode ───────────
  "devstral-small-2507": { displayName: "Devstral-Small-2507", reasoning: false, input: ["text"], contextWindow: 131072, maxTokens: 65536 },

  // ── Qwen2.5-VL (vision-language, largest) — no thinking mode ────
  "qwen2.5-vl-72b-instruct": { displayName: "Qwen2.5-VL-72B", reasoning: false, input: ["text", "image"], contextWindow: 131072, maxTokens: 65536 },

  // ── Bonsai-27B (community fine-tune) — no official thinking docs ─
  "bonsai-27b@q1_0": { displayName: "Bonsai-27B Q1", reasoning: false, input: ["text", "image"], contextWindow: 131072, maxTokens: 65536 },
  "bonsai-27b@q4_1": { displayName: "Bonsai-27B Q4", reasoning: false, input: ["text", "image"], contextWindow: 131072, maxTokens: 65536 },

  // ── Embedding models (skipped by isEmbeddingModel) ──────────────
  "text-embedding-nomic-embed-text-v1.5": { reasoning: false, input: ["text"], contextWindow: 8192, maxTokens: 0 },
};

function isEmbeddingModel(id: string): boolean {
  return id.includes("embedding") || id.includes("embed");
}

// ─── Models.json helpers ──────────────────────────────────────────────────────

// ─── Models.json schema (on disk) ─────────────────────────────────────────────
// Note: models.json is a subset of PI's ProviderModelConfig.
// When passed to pi.registerProvider(), we fill in required fields (name, cost).

interface ModelEntry {
  id: string;
  reasoning?: boolean;
  input?: ("text" | "image")[];
  contextWindow?: number;
  maxTokens?: number;
  // Qwen3.6/3.8 thinking mode parameters
  reasoningEffort?: ReasoningEffort;
  preserveThinking?: boolean;
}

// ─── PI ProviderModelConfig (required by registerProvider) ─────────────────────
interface FullModelConfig {
  id: string;
  name: string;
  reasoning: boolean;
  input: ("text" | "image")[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
}

interface ProviderConfig {
  baseUrl: string;
  api: string;
  apiKey: string;
  compat?: Record<string, unknown>;
  models: ModelEntry[];
}

interface ModelsJson {
  providers: Record<string, ProviderConfig>;
}

function loadModelsJson(): ModelsJson | null {
  if (!fs.existsSync(MODELS_JSON)) return null;
  try {
    return JSON.parse(fs.readFileSync(MODELS_JSON, "utf-8"));
  } catch {
    return null;
  }
}

function saveModelsJson(data: ModelsJson): void {
  fs.writeFileSync(MODELS_JSON, JSON.stringify(data, null, 2) + "\n");
}

// ─── Convert ModelEntry → FullModelConfig for registerProvider ────────────────

function toFullConfig(entry: ModelEntry): FullModelConfig {
  const spec = KNOWN_SPECS[entry.id];
  return {
    id: entry.id,
    name: spec?.displayName ?? entry.id.replace(/[-_]/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
    reasoning: entry.reasoning ?? false,
    input: entry.input ?? ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, // Local = free
    contextWindow: entry.contextWindow ?? 128000,
    maxTokens: entry.maxTokens ?? 16384,
  };
}

// ─── Fetch models from LM Studio ──────────────────────────────────────────────

async function fetchServerModels(baseUrl: string, apiKey?: string): Promise<string[]> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const res = await fetch(`${baseUrl}/models`, { headers });
  if (!res.ok) throw new Error(`Failed to fetch models: ${res.status} ${res.statusText}`);
  const data = await res.json();
  return (data.data ?? [])
    .map((m: { id: string }) => m.id)
    .filter((id: string) => !isEmbeddingModel(id));
}

// ─── /model-update command ────────────────────────────────────────────────────

async function runModelUpdate(ctx: Parameters<ExtensionAPI["registerCommand"]>[1]["handler"] extends (args: any, ctx: infer C) => any ? C : never): Promise<void> {
  const data = loadModelsJson();
  if (!data) {
    ctx.ui.notify("No models.json found. Create one first.", "error");
    return;
  }

  // Find the lmstudio provider (or first openai-completions provider)
  let providerName = "lmstudio";
  let provider: ProviderConfig | undefined = data.providers[providerName];
  if (!provider) {
    for (const [name, cfg] of Object.entries(data.providers)) {
      if (cfg.api === "openai-completions") {
        providerName = name;
        provider = cfg as ProviderConfig;
        break;
      }
    }
  }
  if (!provider) {
    ctx.ui.notify("No OpenAI-compatible provider found in models.json", "error");
    return;
  }

  const baseUrl = provider.baseUrl.replace(/\/+$/, ""); // strip trailing slash
  const apiKey = provider.apiKey;

  try {
    const serverModels = await fetchServerModels(baseUrl, apiKey);
    if (serverModels.length === 0) {
      ctx.ui.notify("No models found on server", "warning");
      return;
    }

    // Merge: keep existing entries, add new ones with specs
    const existingIds = new Set(provider.models.map((m) => m.id));
    let added = 0;
    for (const id of serverModels) {
      if (!existingIds.has(id)) {
        const spec = KNOWN_SPECS[id];
        const entry: ModelEntry = { id };
        if (spec) {
          if (spec.reasoning) entry.reasoning = true;
          if (spec.input.length > 1) entry.input = spec.input;
          // Only set contextWindow/maxTokens if they differ from defaults
          if (spec.contextWindow !== 128000) entry.contextWindow = spec.contextWindow;
          if (spec.maxTokens !== 16384) entry.maxTokens = spec.maxTokens;
        }
        provider.models.push(entry);
        added++;
      }
    }

    // Remove models no longer on server
    const beforeCount = provider.models.length;
    provider.models = provider.models.filter((m) => serverModels.includes(m.id));
    const removed = beforeCount - provider.models.length;

    // Fix compat: LM Studio API supports reasoning_effort (tested Aug 2026)
    if (!provider.compat) {
      provider.compat = {};
    }
    provider.compat.supportsReasoningEffort = true;

    saveModelsJson(data);

    let msg = `Updated: +${added} added`;
    if (removed > 0) msg += `, -${removed} removed`;
    ctx.ui.notify(msg, "info");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.ui.notify(`Failed to fetch models: ${message}`, "error");
  }
}

// ─── /model-config command ────────────────────────────────────────────────────

async function runModelConfig(
  pi: ExtensionAPI,
  ctx: Parameters<ExtensionAPI["registerCommand"]>[1]["handler"] extends (args: any, ctx: infer C) => any ? C : never,
): Promise<void> {
  const data = loadModelsJson();
  if (!data) {
    ctx.ui.notify("No models.json found", "error");
    return;
  }

  // Find provider with most models (or lmstudio)
  let providerName = "lmstudio";
  let provider: ProviderConfig | undefined = data.providers[providerName];
  if (!provider) {
    for (const [name, cfg] of Object.entries(data.providers)) {
      if ((cfg.models?.length ?? 0) >= (provider?.models?.length ?? 0)) {
        providerName = name;
        provider = cfg as ProviderConfig;
      }
    }
  }
  if (!provider || provider.models.length === 0) {
    ctx.ui.notify("No models configured", "error");
    return;
  }

  // Step 1: Select a model
  const modelItems: SelectItem[] = provider.models.map((m, i) => ({
    value: String(i),
    label: m.id,
    description: buildModelSummary(m),
  }));

  const selectedIndex = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
    const container = new Container();
    container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
    container.addChild(new Text(theme.fg("accent", theme.bold("Select Model to Configure")), 1, 0));

    const list = new SelectList(modelItems, Math.min(modelItems.length, 15), {
      selectedPrefix: (t) => theme.fg("accent", t),
      selectedText: (t) => theme.fg("accent", t),
      description: (t) => theme.fg("muted", t),
      scrollInfo: (t) => theme.fg("dim", t),
      noMatch: (t) => theme.fg("warning", t),
    });
    list.onSelect = (item) => done(item.value);
    list.onCancel = () => done(null);
    container.addChild(list);

    container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter select • esc cancel"), 1, 0));
    container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

    return {
      render: (w) => container.render(w),
      invalidate: () => container.invalidate(),
      handleInput: (d) => { list.handleInput(d); tui.requestRender(); },
    };
  });

  if (selectedIndex === null) return;

  const model = provider.models[parseInt(selectedIndex)];
  if (!model) return;

  // Step 2: Show configuration options
  await showModelConfig(pi, ctx, data, providerName, provider, model);
}

function buildModelSummary(m: ModelEntry): string {
  const parts: string[] = [];
  if (m.reasoning) {
    const spec = KNOWN_SPECS[m.id];
    const defaultEffort = spec?.reasoningEffortOptions?.[0] ?? "medium";
    parts.push(`reasoning (${m.reasoningEffort ?? defaultEffort})`);
    if (m.preserveThinking) parts.push("preserve-thinking");
  }
  if (m.input?.includes("image")) parts.push("vision");
  if (m.contextWindow) parts.push(`${m.contextWindow / 1024}K ctx`);
  return parts.join(" • ");
}

async function showModelConfig(
  pi: ExtensionAPI,
  ctx: Parameters<ExtensionAPI["registerCommand"]>[1]["handler"] extends (args: any, ctx: infer C) => any ? C : never,
  data: ModelsJson,
  providerName: string,
  provider: ProviderConfig,
  model: ModelEntry,
): Promise<void> {
  // Track original values for change detection
  const originalContextWindow = model.contextWindow;
  let contextWindowChanged = false;

  // Build settings list — include thinking params only for reasoning-capable models
  const hasReasoning = model.reasoning ?? false;
  const settingsItems: SettingItem[] = [
    {
      id: "reasoning",
      label: `Thinking mode (enable_thinking)`,
      currentValue: String(hasReasoning),
      values: ["true", "false"],
    },
    {
      id: "vision",
      label: `Vision support (image input)`,
      currentValue: String(model.input?.includes("image") ?? false),
      values: ["true", "false"],
    },
    {
      id: "contextWindow",
      label: `Context window (tokens)`,
      currentValue: model.contextWindow === undefined ? "auto" : String(model.contextWindow),
      values: ["auto", "32768", "65536", "131072", "262144", "524288"],
    },
    {
      id: "maxTokens",
      label: `Max output tokens`,
      currentValue: model.maxTokens === undefined ? "auto" : String(model.maxTokens),
      values: ["auto", "8192", "16384", "32768", "65536", "81920"],
    },
  ];

  // Add thinking-mode-specific params for reasoning-capable models
  if (hasReasoning) {
    const spec = KNOWN_SPECS[model.id];
    const effortOptions = spec?.reasoningEffortOptions ?? ["xhigh", "medium", "low"];
    settingsItems.push({
      id: "reasoningEffort",
      label: `Reasoning effort (depth of thought)`,
      currentValue: model.reasoningEffort ?? effortOptions[0],
      values: effortOptions,
    });
    settingsItems.push({
      id: "preserveThinking",
      label: `Preserve thinking in history`,
      currentValue: String(model.preserveThinking ?? false),
      values: ["true", "false"],
    });
  }

  await ctx.ui.custom((_tui, theme, _kb, done) => {
    const container = new Container();
    container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
    container.addChild(new Text(theme.fg("accent", theme.bold(`Configure: ${model.id}`)), 1, 0));
    container.addChild(new Spacer(1));

    const settingsList = new SettingsList(
      settingsItems,
      Math.min(settingsItems.length + 2, 15),
      getSettingsListTheme(),
      (id, newValue) => {
        // Apply changes to model entry
        switch (id) {
          case "reasoning":
            model.reasoning = newValue === "true";
            break;
          case "vision":
            if (newValue === "true") {
              model.input = ["text", "image"];
            } else {
              model.input = ["text"];
            }
            break;
          case "contextWindow":
            const newCw = newValue === "auto" ? undefined : parseInt(newValue);
            if (newCw !== originalContextWindow) {
              contextWindowChanged = true;
            }
            model.contextWindow = newCw;
            break;
          case "maxTokens":
            if (newValue === "auto") {
              delete model.maxTokens;
            } else {
              model.maxTokens = parseInt(newValue);
            }
            break;
          case "reasoningEffort":
            model.reasoningEffort = newValue as ReasoningEffort;
            break;
          case "preserveThinking":
            model.preserveThinking = newValue === "true";
            break;
        }
      },
      () => done(undefined), // On close
    );
    container.addChild(settingsList);

    container.addChild(new Spacer(1));
    container.addChild(new Text(theme.fg("dim", "↑↓ navigate • ←→ toggle • esc save & close"), 1, 0));
    container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

    return {
      render: (w) => container.render(w),
      invalidate: () => container.invalidate(),
      handleInput: (d) => settingsList.handleInput?.(d),
    };
  });

  // Check if context window was changed and prompt for confirmation
  if (contextWindowChanged) {
    const confirmed = await ctx.ui.custom<boolean>((tui, theme, _kb, done) => {
      const container = new Container();
      container.addChild(new DynamicBorder((s: string) => theme.fg("warning", s)));
      container.addChild(new Text(theme.fg("accent", theme.bold("Context Window Changed")), 1, 0));
      container.addChild(new Spacer(1));
      container.addChild(new Text(
        theme.fg("text", "Changing the context window mid-session may disrupt TUI token calculations and auto-compaction thresholds."),
        1,
        0,
      ));
      container.addChild(new Spacer(1));
      container.addChild(new Text(
        theme.fg("warning", "A compaction will be triggered to recalculate context usage before the new size takes effect."),
        1,
        0,
      ));
      container.addChild(new Spacer(1));
      container.addChild(new Text(theme.fg("dim", "Continue? [y/n]"), 1, 0));
      container.addChild(new DynamicBorder((s: string) => theme.fg("warning", s)));

      return {
        render: (w) => container.render(w),
        invalidate: () => {},
        handleInput: (d) => {
          if (d === "y" || d === "Y") done(true);
          else if (d === "n" || d === "N") done(false);
        },
      };
    });

    if (!confirmed) {
      // Revert context window change
      model.contextWindow = originalContextWindow;
      ctx.ui.notify("Context window change cancelled", "info");
      return; // Don't save
    }
  }

  // Save to disk
  saveModelsJson(data);

  // Apply immediately mid-session via registerProvider (takes effect without reload)
  // Convert ModelEntry[] → FullModelConfig[] for PI's type requirements
  const fullProvider = {
    ...provider,
    models: provider.models.map(toFullConfig),
  };
  pi.registerProvider(providerName, fullProvider);
  ctx.ui.notify(`Saved config for ${model.id}`, "info");

  // Trigger compaction if context window was changed and confirmed
  if (contextWindowChanged) {
    ctx.compact({
      onComplete: () => ctx.ui.notify("Compaction complete — new context window active", "info"),
      onError: (err) => ctx.ui.notify(`Compaction failed: ${err.message ?? err}`, "error"),
    });
  }
}

// ─── Auto-fix compat settings on load ────────────────────────────────────────

function fixCompatSettings(): void {
  const data = loadModelsJson();
  if (!data) return;
  let changed = false;
  for (const provider of Object.values(data.providers)) {
    if (provider.api === "openai-completions") {
      // LM Studio API supports reasoning_effort — fix if wrong
      if (provider.compat?.supportsReasoningEffort === false) {
        provider.compat.supportsReasoningEffort = true;
        changed = true;
      }
    }
  }
  if (changed) saveModelsJson(data);
}

// ─── Main Extension ──────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // Auto-fix compat settings on load
  fixCompatSettings();

  pi.registerCommand("model-update", {
    description: "Query server for fresh model list and update models.json",
    handler: async (_args, ctx) => {
      await runModelUpdate(ctx);
    },
  });

  pi.registerCommand("model-config", {
    description: "Configure per-model settings (reasoning, context window, etc.)",
    handler: async (_args, ctx) => {
      await runModelConfig(pi, ctx);
    },
  });
}
