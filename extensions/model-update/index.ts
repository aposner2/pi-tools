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

// ─── Known Model Specs (from HuggingFace) ─────────────────────────────────────

interface ModelSpec {
  reasoning?: boolean;
  input: string[];
  contextWindow: number;
  maxTokens: number;
}

const KNOWN_SPECS: Record<string, ModelSpec> = {
  // Qwen3.6 family
  "qwen/qwen3.6-27b": { reasoning: true, input: ["text", "image"], contextWindow: 262144, maxTokens: 81920 },
  "qwen3.6-27b-mtp": { reasoning: true, input: ["text", "image"], contextWindow: 262144, maxTokens: 81920 },
  "qwen/qwen3.6-35b-a3b": { reasoning: true, input: ["text", "image"], contextWindow: 262144, maxTokens: 81920 },

  // Qwen3-Coder-Next (80B MoE, 3B active)
  "qwen/qwen3-coder-next": { reasoning: true, input: ["text"], contextWindow: 262144, maxTokens: 81920 },

  // Qwen2.5-Coder-32B
  "qwen2.5-coder-32b-instruct": { reasoning: false, input: ["text"], contextWindow: 131072, maxTokens: 32768 },

  // Gemma 4 family
  "google/gemma-4-31b": { reasoning: true, input: ["text", "image"], contextWindow: 524288, maxTokens: 81920 },
  "google/gemma-4-26b-a4b-qat": { reasoning: true, input: ["text", "image"], contextWindow: 524288, maxTokens: 81920 },
  "google/gemma-4-12b-qat": { reasoning: true, input: ["text", "image"], contextWindow: 524288, maxTokens: 81920 },
  "google/gemma-4-e4b": { reasoning: false, input: ["text"], contextWindow: 524288, maxTokens: 32768 },

  // Embedding models (skip)
  "text-embedding-nomic-embed-text-v1.5": { reasoning: false, input: ["text"], contextWindow: 8192, maxTokens: 0 },
};

function isEmbeddingModel(id: string): boolean {
  return id.includes("embedding") || id.includes("embed");
}

// ─── Models.json helpers ──────────────────────────────────────────────────────

interface ModelEntry {
  id: string;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  compat?: Record<string, unknown>;
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

async function runModelConfig(ctx: Parameters<ExtensionAPI["registerCommand"]>[1]["handler"] extends (args: any, ctx: infer C) => any ? C : never): Promise<void> {
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
  await showModelConfig(ctx, data, providerName, provider, model);
}

function buildModelSummary(m: ModelEntry): string {
  const parts: string[] = [];
  if (m.reasoning) parts.push("reasoning");
  if (m.input?.includes("image")) parts.push("vision");
  if (m.contextWindow) parts.push(`${m.contextWindow / 1024}K ctx`);
  return parts.join(" • ");
}

async function showModelConfig(
  ctx: Parameters<ExtensionAPI["registerCommand"]>[1]["handler"] extends (args: any, ctx: infer C) => any ? C : never,
  data: ModelsJson,
  providerName: string,
  provider: ProviderConfig,
  model: ModelEntry,
): Promise<void> {
  // Track original context window to detect changes
  const originalContextWindow = model.contextWindow;

  const settingsItems: SettingItem[] = [
    {
      id: "reasoning",
      label: `Reasoning (thinking mode)`,
      currentValue: String(model.reasoning ?? false),
      values: ["true", "false"],
    },
    {
      id: "vision",
      label: `Vision support`,
      currentValue: String(model.input?.includes("image") ?? false),
      values: ["true", "false"],
    },
    {
      id: "contextWindow",
      label: `Context window (tokens)`,
      currentValue: String(model.contextWindow ?? 128000),
      values: ["auto", "32768", "65536", "131072", "262144", "524288"],
    },
    {
      id: "maxTokens",
      label: `Max output tokens`,
      currentValue: String(model.maxTokens ?? 16384),
      values: ["auto", "8192", "16384", "32768", "65536", "81920"],
    },
  ];

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
            if (newValue === "auto") {
              delete model.contextWindow;
            } else {
              model.contextWindow = parseInt(newValue);
            }
            break;
          case "maxTokens":
            if (newValue === "auto") {
              delete model.maxTokens;
            } else {
              model.maxTokens = parseInt(newValue);
            }
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
  const newContextWindow = model.contextWindow;
  const contextWindowChanged = originalContextWindow !== newContextWindow;

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

  // Save after closing the UI (or after confirmation)
  saveModelsJson(data);
  ctx.ui.notify(`Saved config for ${model.id}`, "info");

  // Trigger compaction if context window was changed and confirmed
  if (contextWindowChanged) {
    ctx.compact({
      onComplete: () => ctx.ui.notify("Compaction complete — new context window active", "info"),
      onError: (err) => ctx.ui.notify(`Compaction failed: ${err.message ?? err}`, "error"),
    });
  }
}

// ─── Main Extension ──────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.registerCommand("model-update", {
    description: "Query server for fresh model list and update models.json",
    handler: async (_args, ctx) => {
      await runModelUpdate(ctx);
    },
  });

  pi.registerCommand("model-config", {
    description: "Configure per-model settings (reasoning, context window, etc.)",
    handler: async (_args, ctx) => {
      await runModelConfig(ctx);
    },
  });
}
