# Model Update Extension

Keeps your `models.json` in sync with your LM Studio server and provides interactive per-model configuration.

## Commands

| Command | Description |
|---------|-------------|
| `/model-update` | Query server for fresh model list, add new models with specs from HuggingFace docs |
| `/model-config` | Interactive UI to configure reasoning, vision, context window, max tokens, reasoning effort per model |

## What it does

### `/model-update`
1. Queries your LM Studio server's `/v1/models` endpoint
2. Compares against existing `models.json` entries
3. Adds new models with specs from HuggingFace documentation (reasoning, vision, context window)
4. Removes models no longer on the server
5. Skips embedding models automatically
6. Auto-fixes `compat.supportsReasoningEffort` to `true` (LM Studio API supports it)

### `/model-config`
1. Select a model from a list
2. Toggle settings:
   - **Thinking mode**: Enable/disable extended thinking (`enable_thinking`)
   - **Vision support**: Enable/disable image input
   - **Context window**: Set token limit (auto = Pi default)
   - **Max output tokens**: Set max response length (auto = Pi default)
3. For reasoning-capable models, additional options:
   - **Reasoning effort**: `low` / `medium` / `high` — controls depth of thought
   - **Preserve thinking**: Retain reasoning context from history messages
4. Changes saved to `~/.pi/agent/models.json` immediately and applied mid-session via `pi.registerProvider()`

## Auto-fix on load

When the extension loads, it automatically fixes `compat.supportsReasoningEffort` in models.json if set to `false`. The LM Studio API supports this parameter (tested Aug 2026).

## Known Model Specs

Built-in specs from HuggingFace for:
- Qwen3.8-27B (reasoning, vision, 262K context)
- Qwen3.6 family (MTP variants, uncensored fine-tune)
- Qwen3-Coder-30B-A3B-Instruct (MoE coding specialist)
- Devstral-Small-2507 (Mistral coding agent, 128K context)
- Qwen2.5-VL-72B (vision-language, largest model)
- Bonsai-27B community fine-tunes

## LM Studio API Parameters

The extension configures these per-request parameters that the LM Studio server accepts:

| Parameter | Type | Options/Bounds | Models |
|-----------|------|----------------|--------|
| `reasoning_effort` | string | `"low"`, `"medium"`, `"high"` | Qwen3.6, Qwen3.8 |
| `preserve_thinking` | boolean | `true` / `false` | Qwen3.6, Qwen3.8 |
| `temperature` | float | 0.1–2.0 | All models |
| `top_p` | float | 0.1–1.0 | All models |
