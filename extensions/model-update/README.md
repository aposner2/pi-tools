# Model Update Extension

Keeps your `models.json` in sync with your LM Studio server and provides interactive per-model configuration.

## Commands

| Command | Description |
|---------|-------------|
| `/model-update` | Query server for fresh model list, add new models with specs from HuggingFace docs |
| `/model-config` | Interactive UI to configure reasoning, vision, context window, max tokens per model |

## What it does

### `/model-update`
1. Queries your LM Studio server's `/v1/models` endpoint
2. Compares against existing `models.json` entries
3. Adds new models with specs from HuggingFace documentation (reasoning, vision, context window)
4. Removes models no longer on the server
5. Skips embedding models automatically

### `/model-config`
1. Select a model from a list
2. Toggle settings:
   - **Reasoning**: Enable/disable thinking mode (`enable_thinking`)
   - **Vision**: Enable/disable image input support
   - **Context Window**: Set token limit (auto = Pi default)
   - **Max Output Tokens**: Set max response length (auto = Pi default)
3. Changes saved to `~/.pi/agent/models.json` immediately

## Known Model Specs

Built-in specs from HuggingFace for:
- Qwen3.6 family (27B, 35B-A3B, MTP variants)
- Qwen3-Coder-Next
- Qwen2.5-Coder-32B
- Gemma 4 family (12B, 26B, 31B, E4B)
