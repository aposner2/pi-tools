/**
 * Model Update Extension
 *
 * Commands:
 *   /model-update    - Query LM Studio for fresh model list and update models.json
 *   /model-config    - Interactive per-model configuration (reasoning, context window, etc.)
 *
 * Tools:
 *   lms-show-config  - Agent-callable: display current config for one or all models
 *   lms-set-param    - Agent-callable: set a parameter value (validated against bounds)
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, type SelectItem, SelectList, Text, Spacer, type SettingItem, SettingsList } from "@earendil-works/pi-tui";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// ─── Paths ───────────────────────────────────────────────────────────────────

const MODELS_JSON = path.join(os.homedir(), ".pi", "agent", "models.json");

// Track the active model id (updated on model_select events)
let activeModelId: string | undefined;

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
  // Sampling defaults
  defaultTemperature?: number;
  defaultTopP?: number;
}

const KNOWN_SPECS: Record<string, ModelSpec> = {
  // ── Qwen3.8 family (newest) ─────────────────────────────────────
  // Official docs: reasoning_effort options are xhigh (default), medium, low
  "qwen/qwen3.8-27b": { displayName: "Qwen3.8-27B", reasoning: true, input: ["text", "image"], contextWindow: 262144, maxTokens: 81920, reasoningEffortOptions: ["xhigh", "medium", "low"], defaultTemperature: 0.7, defaultTopP: 0.95 },

  // ── Qwen3.6 family (MTP + uncensored) ───────────────────────────
  // LMS API accepts all four values; xhigh tested and working
  "qwen3.6-27b-mtp": { displayName: "Qwen3.6-27B-MTP", reasoning: true, input: ["text", "image"], contextWindow: 262144, maxTokens: 81920, reasoningEffortOptions: ["xhigh", "high", "medium", "low"], defaultTemperature: 0.7, defaultTopP: 0.95 },
  // Uncensored fine-tune of Qwen3.6 — supports thinking mode (default on)
  "qwen3.6-35b-a3b-uncensored-hauhaucs-aggressive": { displayName: "Qwen3.6-35B-A3B Uncensored", reasoning: true, input: ["text", "image"], contextWindow: 262144, maxTokens: 81920, reasoningEffortOptions: ["xhigh", "high", "medium", "low"], defaultTemperature: 0.7, defaultTopP: 0.95 },

  // ── Qwen3-Coder (MoE) — non-thinking only per HF docs ───────────
  "qwen/qwen3-coder-30b": { displayName: "Qwen3-Coder-30B-A3B", reasoning: false, input: ["text"], contextWindow: 262144, maxTokens: 81920, defaultTemperature: 0.2, defaultTopP: 0.95 },

  // ── Mistral Devstral (coding agent) — no thinking mode ───────────
  "devstral-small-2507": { displayName: "Devstral-Small-2507", reasoning: false, input: ["text"], contextWindow: 131072, maxTokens: 65536, defaultTemperature: 0.3, defaultTopP: 0.95 },

  // ── Qwen2.5-VL (vision-language, largest) — no thinking mode ────
  "qwen2.5-vl-72b-instruct": { displayName: "Qwen2.5-VL-72B", reasoning: false, input: ["text", "image"], contextWindow: 131072, maxTokens: 65536, defaultTemperature: 0.7, defaultTopP: 0.95 },

  // ── Bonsai-27B (community fine-tune) — no official thinking docs ─
  "bonsai-27b@q1_0": { displayName: "Bonsai-27B Q1", reasoning: false, input: ["text", "image"], contextWindow: 131072, maxTokens: 65536, defaultTemperature: 0.7, defaultTopP: 0.95 },
  "bonsai-27b@q4_1": { displayName: "Bonsai-27B Q4", reasoning: false, input: ["text", "image"], contextWindow: 131072, maxTokens: 65536, defaultTemperature: 0.7, defaultTopP: 0.95 },

  // ── Embedding models (skipped by isEmbeddingModel) ──────────────
  "text-embedding-nomic-embed-text-v1.5": { reasoning: false, input: ["text"], contextWindow: 8192, maxTokens: 0 },
};

function isEmbeddingModel(id: string): boolean {
  return id.includes("embedding") || id.includes("embed");
}

// ─── Human-readable token formatting ─────────────────────────────────────────

function formatTokens(tokens: number): string {
  if (tokens >= 1024) {
    const kb = tokens / 1024;
    return kb >= 1024 ? `${kb / 1024}M` : `${kb}K`;
  }
  return String(tokens);
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
  // Sampling defaults
  temperature?: number;
  topP?: number;
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
  // Declares which thinking levels this model supports. PI only offers
  // xhigh/max if thinkingLevelMap[level] is defined (see getSupportedThinkingLevels).
  thinkingLevelMap?: Record<string, string | null>;
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
  const config: FullModelConfig = {
    id: entry.id,
    name: spec?.displayName ?? entry.id.replace(/[-_]/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
    reasoning: entry.reasoning ?? false,
    input: entry.input ?? ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, // Local = free
    contextWindow: entry.contextWindow ?? 128000,
    maxTokens: entry.maxTokens ?? 16384,
  };

  // Declare supported thinking levels so PI doesn't clamp xhigh.
  // PI requires thinkingLevelMap[level] to be defined for xhigh/max to be
  // available. Identity mapping: the level string is sent as-is as the
  // reasoning_effort API param (openai-completions uses thinkingLevelMap[level] ?? level).
  if (entry.reasoning && spec?.reasoningEffortOptions?.length) {
    const map: Record<string, string | null> = {};
    for (const opt of spec.reasoningEffortOptions) {
      map[opt] = opt;
    }
    config.thinkingLevelMap = map;
  }

  return config;
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
          // Set sampling defaults from spec
          if (spec.defaultTemperature !== undefined) entry.temperature = spec.defaultTemperature;
          if (spec.defaultTopP !== undefined) entry.topP = spec.defaultTopP;
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

// ─── Helper: build "default (value)" option label ────────────────────────────

function defaultLabel(param: string, spec: ModelSpec | undefined, entry: ModelEntry): string {
  // Get the actual default value from spec or entry
  let val: string;
  switch (param) {
    case "contextWindow":
      val = formatTokens(spec?.contextWindow ?? entry.contextWindow ?? 128000);
      break;
    case "maxTokens":
      val = formatTokens(spec?.maxTokens ?? entry.maxTokens ?? 16384);
      break;
    case "temperature":
      val = String(spec?.defaultTemperature ?? entry.temperature ?? 0.7);
      break;
    case "topP":
      val = String(spec?.defaultTopP ?? entry.topP ?? 0.95);
      break;
    default:
      val = "auto";
  }
  return `default (${val})`;
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
  const spec = KNOWN_SPECS[m.id];
  if (m.reasoning) {
    const defaultEffort = spec?.reasoningEffortOptions?.[0] ?? "medium";
    parts.push(`reasoning (${m.reasoningEffort ?? defaultEffort})`);
    if (m.preserveThinking) parts.push("preserve-thinking");
  }
  if (m.input?.includes("image")) parts.push("vision");
  parts.push(`${formatTokens(m.contextWindow ?? spec?.contextWindow ?? 128000)} ctx`);
  if (m.temperature !== undefined) parts.push(`t=${m.temperature}`);
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

  const spec = KNOWN_SPECS[model.id];
  const hasReasoning = model.reasoning ?? false;

  // Build the "default" option labels dynamically
  const ctxDefault = defaultLabel("contextWindow", spec, model);
  const maxTokDefault = defaultLabel("maxTokens", spec, model);
  const tempDefault = defaultLabel("temperature", spec, model);
  const topPDefault = defaultLabel("topP", spec, model);

  // Build settings list with descriptions and "default (value)" pattern
  const settingsItems: SettingItem[] = [
    {
      id: "reasoning",
      label: "Thinking mode",
      description: "Enable/disable chain-of-thought reasoning. When enabled, the model produces extended internal reasoning before responding.",
      currentValue: String(hasReasoning),
      values: ["true", "false"],
    },
    {
      id: "vision",
      label: "Vision support",
      description: "Allow image input to be sent to the model for multimodal understanding.",
      currentValue: String(model.input?.includes("image") ?? false),
      values: ["true", "false"],
    },
    {
      id: "contextWindow",
      label: "Context window",
      description: "Maximum tokens of prior conversation the model can see. Higher = more memory but slower. Use default for model-optimized size.",
      currentValue: model.contextWindow === undefined ? ctxDefault : formatTokens(model.contextWindow),
      values: [ctxDefault, "32K", "64K", "128K", "256K", "512K"],
    },
    {
      id: "maxTokens",
      label: "Max output tokens",
      description: "Maximum tokens the model can generate per response. Limits output length to prevent runaway generation.",
      currentValue: model.maxTokens === undefined ? maxTokDefault : formatTokens(model.maxTokens),
      values: [maxTokDefault, "8K", "16K", "32K", "64K", "80K"],
    },
    {
      id: "temperature",
      label: "Temperature",
      description: "Sampling randomness. Lower = deterministic/focused (good for code). Higher = creative/diverse. 0.1-0.4 for code, 0.7 for general, 1.0+ for creative.",
      currentValue: model.temperature === undefined ? tempDefault : String(model.temperature),
      values: [tempDefault, "0.1", "0.2", "0.3", "0.5", "0.7", "1.0", "1.5"],
    },
    {
      id: "topP",
      label: "Top-p (nucleus)",
      description: "Nucleus sampling threshold. Only sample from tokens with cumulative probability ≤ this value. 0.9 is standard; lower is more focused.",
      currentValue: model.topP === undefined ? topPDefault : String(model.topP),
      values: [topPDefault, "0.5", "0.8", "0.9", "0.95", "1.0"],
    },
  ];

  // Add thinking-mode-specific params for reasoning-capable models
  if (hasReasoning) {
    const effortOptions = spec?.reasoningEffortOptions ?? ["xhigh", "medium", "low"];
    settingsItems.push(
      {
        id: "reasoningEffort",
        label: "Reasoning effort",
        description: "Depth of chain-of-thought. xhigh ≈ 32K reasoning tokens, high ≈ 16K, medium ≈ 8K, low ≈ 2K. More effort = better on complex tasks but slower.",
        currentValue: model.reasoningEffort ?? effortOptions[0],
        values: effortOptions,
      },
      {
        id: "preserveThinking",
        label: "Preserve thinking",
        description: "Keep reasoning blocks from prior turns in context. Improves multi-turn coherence for complex tasks but increases token usage.",
        currentValue: String(model.preserveThinking ?? false),
        values: ["true", "false"],
      },
    );
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
        // Handle "default (X)" pattern — strip to detect default selection
        const isDefault = newValue.startsWith("default (");

        // Apply changes to model entry
        switch (id) {
          case "reasoning":
            model.reasoning = newValue === "true";
            break;
          case "vision":
            model.input = newValue === "true" ? ["text", "image"] : ["text"];
            break;
          case "contextWindow":
            if (isDefault) {
              // Use the spec default
              const specCw = spec?.contextWindow;
              model.contextWindow = specCw !== undefined && specCw !== 128000 ? specCw : undefined;
            } else {
              const parsed = parseInt(newValue.replace(/[KMG]/, "")) * (newValue.includes("M") ? 1048576 : newValue.includes("K") ? 1024 : 1);
              model.contextWindow = parsed;
            }
            if (model.contextWindow !== originalContextWindow) {
              contextWindowChanged = true;
            }
            break;
          case "maxTokens":
            if (isDefault) {
              const specMk = spec?.maxTokens;
              model.maxTokens = specMk !== undefined && specMk !== 16384 ? specMk : undefined;
            } else {
              const parsed = parseInt(newValue.replace(/[KMG]/, "")) * (newValue.includes("M") ? 1048576 : newValue.includes("K") ? 1024 : 1);
              model.maxTokens = parsed;
            }
            break;
          case "temperature":
            model.temperature = isDefault ? undefined : parseFloat(newValue);
            break;
          case "topP":
            model.topP = isDefault ? undefined : parseFloat(newValue);
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
      model.contextWindow = originalContextWindow;
      ctx.ui.notify("Context window change cancelled", "info");
      return;
    }
  }

  // Save to disk
  saveModelsJson(data);

  // Apply immediately mid-session via registerProvider
  const fullProvider = {
    ...provider,
    models: provider.models.map(toFullConfig),
  };
  pi.registerProvider(providerName, fullProvider);

  // If the configured model is the active one, sync PI's thinking level
  if (activeModelId === model.id) {
    syncThinkingLevel(pi, model.id);
  }

  ctx.ui.notify(`Saved config for ${model.id}`, "info");

  // Trigger compaction if context window was changed and confirmed
  if (contextWindowChanged) {
    ctx.compact({
      onComplete: () => ctx.ui.notify("Compaction complete — new context window active", "info"),
      onError: (err) => ctx.ui.notify(`Compaction failed: ${err.message ?? err}`, "error"),
    });
  }
}


// ─── lms-show-config tool (agent-callable) ────────────────────────────────────

function buildConfigSummary(model: ModelEntry): string {
  const spec = KNOWN_SPECS[model.id];
  const name = spec?.displayName ?? model.id;
  const lines: string[] = [];

  lines.push(`📦 ${name} (${model.id})`);
  lines.push(`   Architecture: ${spec ? `${spec.input.join(", ")} input${spec.reasoning ? " + reasoning" : ""}` : "unknown"}`);
  lines.push("");

  // Context & output
  const ctx = model.contextWindow ?? spec?.contextWindow ?? 128000;
  lines.push(`   Context:   ${formatTokens(ctx)} tokens`);
  const mk = model.maxTokens ?? spec?.maxTokens ?? 16384;
  lines.push(`   Max output: ${formatTokens(mk)} tokens`);

  // Sampling
  const temp = model.temperature ?? spec?.defaultTemperature ?? 0.7;
  lines.push(`   Temperature: ${temp}`);
  const topP = model.topP ?? spec?.defaultTopP ?? 0.95;
  lines.push(`   Top-p:     ${topP}`);

  // Thinking mode
  if (model.reasoning || spec?.reasoning) {
    const effort = model.reasoningEffort ?? spec?.reasoningEffortOptions?.[0] ?? "medium";
    lines.push(`   Reasoning: ${model.reasoning ? "ON" : "OFF"} (effort: ${effort})`);
    lines.push(`   Preserve thinking: ${model.preserveThinking ? "yes" : "no"}`);
  } else {
    lines.push(`   Reasoning: not supported`);
  }

  // Vision
  lines.push(`   Vision:    ${model.input?.includes("image") ? "enabled" : "disabled"}`);
  lines.push("");

  return lines.join("\n");
}

function lmsShowConfigTool() {
  return {
    name: "lms-show-config",
    label: "Show LMS Model Config",
    description: "Display the current configuration for one or all LM Studio models. Returns model specs, context window, sampling params, and thinking mode settings.",
    parameters: Type.Object({
      model: Type.Optional(Type.String({ description: "Model ID to show config for. Omit to show all models." })),
    }),
    async execute(
      _toolCallId: string,
      params: { model?: string },
      _signal: AbortSignal,
      _onUpdate: (update: any) => void,
      _ctx: any,
    ) {
      const data = loadModelsJson();
      if (!data) {
        return {
          content: [{ type: "text" as const, text: "No models.json found. Run /model-update first to sync from the LMS server." }],
        };
      }

      // Find the lmstudio provider
      let provider: ProviderConfig | undefined = data.providers["lmstudio"];
      if (!provider) {
        for (const cfg of Object.values(data.providers)) {
          if (cfg.api === "openai-completions") {
            provider = cfg as ProviderConfig;
            break;
          }
        }
      }
      if (!provider || provider.models.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No models configured in models.json." }],
        };
      }

      if (params.model) {
        const model = provider.models.find((m) => m.id === params.model);
        if (!model) {
          const available = provider.models.map((m) => m.id).join(", ");
          return {
            content: [{ type: "text" as const, text: `Model '${params.model}' not found. Available: ${available}` }],
          };
        }
        return {
          content: [{ type: "text" as const, text: buildConfigSummary(model) }],
        };
      }

      // Show all models
      const allSummaries = provider.models.map(buildConfigSummary).join("\n");
      return {
        content: [{ type: "text" as const, text: `# LM Studio Model Configurations\n\n${allSummaries}` }],
      };
    },
  };
}

// ─── lms-set-param tool (agent-callable) ──────────────────────────────────────

function lmsSetParamTool(pi: ExtensionAPI) {
  return {
    name: "lms-set-param",
    label: "Set LMS Model Parameter",
    description: "Set a configuration parameter for a specific LM Studio model. Validated against known model bounds. Parameters: contextWindow, maxTokens, temperature, topP, reasoning, reasoningEffort, preserveThinking, vision.",
    parameters: Type.Object({
      model: Type.String({ description: "Model ID to configure (e.g. 'qwen3.6-27b-mtp', 'qwen/qwen3.8-27b')" }),
      param: Type.String({
        description: "Parameter to set: contextWindow, maxTokens, temperature, topP, reasoning, reasoningEffort, preserveThinking, vision",
      }),
      value: Type.String({ description: "Value to set. Numbers as strings (e.g. '131072', '0.7'). Booleans: 'true'/'false'. Reasoning effort: 'low'/'medium'/'high'/'xhigh'." }),
    }),
    async execute(
      _toolCallId: string,
      params: { model: string; param: string; value: string },
      _signal: AbortSignal,
      _onUpdate: (update: any) => void,
      _ctx: any,
    ) {
      const data = loadModelsJson();
      if (!data) {
        return {
          content: [{ type: "text" as const, text: "No models.json found." }],
        };
      }

      // Find provider
      let providerName = "lmstudio";
      let provider: ProviderConfig | undefined = data.providers["lmstudio"];
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
        return { content: [{ type: "text" as const, text: "No OpenAI-compatible provider found." }] };
      }

      const model = provider.models.find((m) => m.id === params.model);
      if (!model) {
        const available = provider.models.map((m) => m.id).join(", ");
        return { content: [{ type: "text" as const, text: `Model '${params.model}' not found. Available: ${available}` }] };
      }

      const spec = KNOWN_SPECS[model.id];
      let oldValue: string;
      let newValue: string;

      switch (params.param) {
        case "contextWindow": {
          oldValue = model.contextWindow === undefined ? `default (${formatTokens(spec?.contextWindow ?? 128000)})` : formatTokens(model.contextWindow);
          if (params.value === "default") {
            const specCw = spec?.contextWindow;
            model.contextWindow = specCw !== undefined && specCw !== 128000 ? specCw : undefined;
          } else {
            const parsed = parseInt(params.value, 10);
            const maxCw = spec?.contextWindow ?? 262144;
            if (parsed > maxCw) {
              return { content: [{ type: "text" as const, text: `Error: ${parsed} exceeds max context window ${formatTokens(maxCw)} for this model.` }] };
            }
            if (parsed < 4096) {
              return { content: [{ type: "text" as const, text: "Error: context window must be at least 4096 tokens." }] };
            }
            model.contextWindow = parsed;
          }
          newValue = model.contextWindow === undefined ? `default (${formatTokens(spec?.contextWindow ?? 128000)})` : formatTokens(model.contextWindow);
          break;
        }
        case "maxTokens": {
          oldValue = model.maxTokens === undefined ? `default (${formatTokens(spec?.maxTokens ?? 16384)})` : formatTokens(model.maxTokens);
          if (params.value === "default") {
            const specMk = spec?.maxTokens;
            model.maxTokens = specMk !== undefined && specMk !== 16384 ? specMk : undefined;
          } else {
            const parsed = parseInt(params.value, 10);
            if (parsed < 128) {
              return { content: [{ type: "text" as const, text: "Error: max tokens must be at least 128." }] };
            }
            model.maxTokens = parsed;
          }
          newValue = model.maxTokens === undefined ? `default (${formatTokens(spec?.maxTokens ?? 16384)})` : formatTokens(model.maxTokens);
          break;
        }
        case "temperature": {
          oldValue = model.temperature === undefined ? `default (${spec?.defaultTemperature ?? 0.7})` : String(model.temperature);
          if (params.value === "default") {
            model.temperature = undefined;
          } else {
            const parsed = parseFloat(params.value);
            if (parsed < 0 || parsed > 2) {
              return { content: [{ type: "text" as const, text: "Error: temperature must be between 0 and 2." }] };
            }
            model.temperature = parsed;
          }
          newValue = model.temperature === undefined ? `default (${spec?.defaultTemperature ?? 0.7})` : String(model.temperature);
          break;
        }
        case "topP": {
          oldValue = model.topP === undefined ? `default (${spec?.defaultTopP ?? 0.95})` : String(model.topP);
          if (params.value === "default") {
            model.topP = undefined;
          } else {
            const parsed = parseFloat(params.value);
            if (parsed < 0.1 || parsed > 1) {
              return { content: [{ type: "text" as const, text: "Error: top_p must be between 0.1 and 1.0." }] };
            }
            model.topP = parsed;
          }
          newValue = model.topP === undefined ? `default (${spec?.defaultTopP ?? 0.95})` : String(model.topP);
          break;
        }
        case "reasoning": {
          oldValue = String(model.reasoning ?? false);
          model.reasoning = params.value === "true";
          newValue = String(model.reasoning);
          break;
        }
        case "reasoningEffort": {
          oldValue = model.reasoningEffort ?? "unset";
          const validEfforts: string[] = spec?.reasoningEffortOptions ?? ["low", "medium", "high", "xhigh"];
          if (!validEfforts.includes(params.value)) {
            return { content: [{ type: "text" as const, text: `Error: invalid effort '${params.value}'. Valid: ${validEfforts.join(", ")}` }] };
          }
          model.reasoningEffort = params.value as ReasoningEffort;
          newValue = params.value;
          break;
        }
        case "preserveThinking": {
          oldValue = String(model.preserveThinking ?? false);
          model.preserveThinking = params.value === "true";
          newValue = String(model.preserveThinking);
          break;
        }
        case "vision": {
          oldValue = String(model.input?.includes("image") ?? false);
          model.input = params.value === "true" ? ["text", "image"] : ["text"];
          newValue = String(params.value === "true");
          break;
        }
        default:
          return { content: [{ type: "text" as const, text: `Unknown parameter '${params.param}'. Valid: contextWindow, maxTokens, temperature, topP, reasoning, reasoningEffort, preserveThinking, vision` }] };
      }

      // Save
      saveModelsJson(data);

      // If this is the active model and we changed a thinking-related param, sync PI's level
      if (activeModelId === params.model && (params.param === "reasoningEffort" || params.param === "reasoning")) {
        syncThinkingLevel(pi, params.model);
      }

      return {
        content: [{
          type: "text" as const,
          text: `✅ ${params.model}: ${params.param} = ${oldValue} → ${newValue}`,
        }],
      };
    },
  };
}


// ─── Sync PI thinking level with per-model reasoningEffort ──────────────────
// PI uses its global thinking level for the reasoning_effort API parameter.
// This keeps the per-model config (models.json) as the source of truth.

function syncThinkingLevel(pi: ExtensionAPI, modelId: string): void {
  const data = loadModelsJson();
  if (!data) return;

  // Find the entry across all providers
  let entry: ModelEntry | undefined;
  for (const provider of Object.values(data.providers)) {
    const found = provider.models.find((m) => m.id === modelId);
    if (found) {
      entry = found;
      break;
    }
  }
  if (!entry) return;

  const spec = KNOWN_SPECS[modelId];

  // Determine target level
  let level: string;
  if (!entry.reasoning) {
    level = "off";
  } else {
    level = entry.reasoningEffort ?? spec?.reasoningEffortOptions?.[0] ?? "medium";
  }

  pi.setThinkingLevel(level as "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max");
}

// ─── Auto-fix compat settings on load ────────────────────────────────────────

function fixCompatSettings(): void {
  const data = loadModelsJson();
  if (!data) return;
  let changed = false;
  for (const provider of Object.values(data.providers)) {
    if (provider.api === "openai-completions") {
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

  // Sync PI's thinking level with per-model config on model change
  pi.on("model_select", async (event) => {
    activeModelId = event.model.id;
    syncThinkingLevel(pi, event.model.id);
  });

  // On session start (covers /reload mid-session where model_select won't re-fire)
  pi.on("session_start", async (_event, ctx: any) => {
    if (ctx.model?.id && ctx.model.id !== activeModelId) {
      activeModelId = ctx.model.id;
      syncThinkingLevel(pi, ctx.model.id);
    }
  });

  // Register commands
  pi.registerCommand("model-update", {
    description: "Query LMS server for fresh model list and update models.json",
    handler: async (_args, ctx) => {
      await runModelUpdate(ctx);
    },
  });

  pi.registerCommand("model-config", {
    description: "Configure per-model settings (reasoning, context, sampling, etc.) via TUI",
    handler: async (_args, ctx) => {
      await runModelConfig(pi, ctx);
    },
  });

  // Register agent-callable tools
  pi.registerTool(lmsShowConfigTool());
  pi.registerTool(lmsSetParamTool(pi));
}
