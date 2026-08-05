# Pi Agent Tool Audit — atlas (this machine)

**Generated:** 2025-08-04  
**Machine:** atlas  
**Pi Core:** `@earendil-works/pi-coding-agent@0.83.0`  
**Default Model:** qwen3.6-27b-mtp via LM Studio on Sparky (192.168.1.2:1234)

---

## 1. Pi Core (Built-in Tools)

| Tool | Source | Description |
|------|--------|-------------|
| `read` | pi-coding-agent | Read files and images from disk |
| `bash` | pi-coding-agent | Execute shell commands |
| `edit` | pi-coding-agent | Precise text replacement in files |
| `write` | pi-coding-agent | Create or overwrite files |
| `ask_user` | pi-coding-agent (base) | Ask the user questions (basic, overridden by extension below) |

**Location:** `/home/aposner/.npm-global/lib/node_modules/@earendil-works/pi-coding-agent/`  
**Installed via:** Global npm (`npm install -g @earendil-works/pi-coding-agent`)

---

## 2. Extension Packages (4 total)

### 2a. pi-tools (git extension) — **Yours**

| Field | Value |
|-------|-------|
| Package | `pi-tools@0.1.0` |
| Source | `git:git@github.com:aposner2/pi-tools` |
| Installed at | `~/.pi/agent/git/github.com/aposner2/pi-tools/` |
| Git commit | `d2aeb92` (master) |

**Extensions (5):**

| Extension | Type | Tools / Functionality |
|-----------|------|----------------------|
| `sudoer/index.ts` | Tool extension | `sudo_auth` — authenticate for sudo access; `sudo_run` — run commands with sudo |
| `large-write/index.ts` | Tool extension | `large_write` — write large files incrementally in chunks under 10KB |
| `hostname-badge/index.ts` | UI extension | Shows persistent hostname badge above input editor (no tools) |
| `model-update/index.ts` | Command extension | `/model-update` — query LM Studio for fresh model list; `/model-config` — interactive per-model config |
| `reranker/index.ts` | Tool extension | `tei_rerank` — rerank documents by relevance using TEI BAAI/bge-reranker-base |

**Skills (4):**

| Skill | Description |
|-------|-------------|
| `init` | Initialize or update AGENTS.md. Analyze codebase and generate context file. |
| `research` | Thorough web research — search, fetch, analyze, produce structured summary with citations. |
| `sys-scan` | Scan system hardware/OS/environment, write results to ~/.pi/sys-scan.md. |
| `large-write` | Use large_write for files over 5KB — split content into chunks under 10KB. |

**Config defaults shipped:**
- `config/mcp.defaults.json` — MCP server templates (searxng + hindsight)
- `config/settings.defaults.json` — Default pi settings
- `config/models.schema.json` — Model provider schema template
- `deploy-hindsight.sh` — One-time setup script for new LAN machines

---

### 2b. pi-mcp-adapter (npm extension)

| Field | Value |
|-------|-------|
| Package | `pi-mcp-adapter@2.20.1` |
| Source | `npm:pi-mcp-adapter` → github.com/nicobailon/pi-mcp-adapter |
| Installed at | `~/.pi/agent/npm/node_modules/pi-mcp-adapter/` |

**Functionality:** Bridges MCP servers into pi as native tools. Discovers, inspects, and calls MCP tool endpoints. Provides the `mcpScript` tool for batch JavaScript MCP orchestration.

**Skills (1):**
| Skill | Description |
|-------|-------------|
| `mcp-scripting` | Write mcpScript JavaScript for discovering, inspecting, and calling MCP tools. |

---

### 2c. pi-ask-user (npm extension)

| Field | Value |
|-------|-------|
| Package | `pi-ask-user@0.14.0` |
| Source | `npm:pi-ask-user` → github.com/edlsh/pi-ask-user |
| Installed at | `~/.pi/agent/npm/node_modules/pi-ask-user/` |

**Tools (1):**
| Tool | Description |
|------|-------------|
| `ask_user` | Interactive decision handshake — summarize context, present structured options, collect explicit user choice. Overrides the basic ask_user from pi core with enhanced UI (modals, keybindings, multi-select). |

**Skills (1):**
| Skill | Description |
|-------|-------------|
| `ask-user` | Use before high-stakes architectural decisions, irreversible changes, or ambiguous requirements. |

---

### 2d. pi-hindsight (npm extension)

| Field | Value |
|-------|-------|
| Package | `pi-hindsight@1.4.2` |
| Source | `npm:pi-hindsight` → github.com/anh-chu/pi-hindsight |
| Installed at | `~/.pi/agent/npm/node_modules/pi-hindsight/` |

**Tools (3):**
| Tool | Description |
|------|-------------|
| `hindsight_recall` | Search memories from hindsight API (semantic + BM25) |
| `hindsight_retain` | Store information to long-term memory (async, fire-and-forget) |
| `hindsight_reflect` | Generate thoughtful analysis by synthesizing stored memories with bank's personality |

**Skills (1):**
| Skill | Description |
|-------|-------------|
| `hindsight-docs` | Complete Hindsight documentation — architecture, APIs, configuration, best practices. Includes full OpenAPI spec, SDK docs, cookbook recipes. |

---

## 3. MCP Servers (2 total)

### 3a. mcp-searxng

| Field | Value |
|-------|-------|
| URL | `http://192.168.1.3:4005/mcp` |
| Config | `~/.pi/agent/mcp.json` (directTools: true) |
| Host machine | 192.168.1.3 (separate server) |

**Tools (2):**
| Tool | Description |
|------|-------------|
| `search-web` | Search the web via SearXNG — returns ranked results with titles, URLs, snippets, relevance scores |
| `fetch-web` | Fetch a URL and return title + main content as clean Markdown |

---

### 3b. hindsight (MCP)

| Field | Value |
|-------|-------|
| URL | `http://192.168.1.4:8888/mcp/alex-ai-global/` |
| Config | `~/.pi/agent/mcp.json` |
| Host machine | 192.168.1.4 (agents server) |

**Tools (28):**

| Tool | Description |
|------|-------------|
| `retain` | Store important information to long-term memory (async) |
| `sync_retain` | Store information and wait for completion (blocking) |
| `recall` | Search memories — semantic, BM25, graph, temporal strategies |
| `reflect` | Autonomous reasoning loop using stored memories + bank personality |
| `list_mental_models` | List pinned reflections (mental models) |
| `get_mental_model` | Get a specific mental model by ID |
| `create_mental_model` | Create a new mental model from a query |
| `update_mental_model` | Update metadata (name, source query, tags) of existing model |
| `delete_mental_model` | Permanently delete a mental model |
| `refresh_mental_model` | Re-run source query to refresh model content |
| `clear_mental_model` | Clear content so next refresh does full re-synthesis |
| `list_directives` | List directives that guide memory engine behavior |
| `create_directive` | Create a new directive for this bank |
| `delete_directive` | Delete a directive permanently |
| `list_memories` | Browse stored memories with optional filtering |
| `get_memory` | Get full memory unit by ID (content, metadata, timestamp) |
| `update_memory` | Edit a memory unit to correct extracted content |
| `invalidate_memory` | Soft-retire or restore a previously retired memory |
| `list_documents` | List documents (containers for related memories) |
| `get_document` | Get document metadata and associated memory info |
| `delete_document` | Delete document and all associated memories |
| `list_operations` | List async background operations |
| `get_operation` | Check status of a specific operation |
| `cancel_operation` | Cancel a pending or running operation |
| `list_tags` | List tags used in this bank |
| `get_bank` | Get bank profile (name, disposition, mission) |
| `update_bank` | Update bank configuration |
| `delete_bank` | Delete bank and all data permanently |
| `clear_memories` | Clear all memories without deleting the bank |

---

## 4. Configuration Files

### ~/.pi/agent/settings.json

```json
{
  "theme": "dark",
  "defaultProvider": "lmstudio",
  "defaultModel": "qwen3.6-27b-mtp",
  "packages": [
    "npm:pi-mcp-adapter",
    "npm:pi-ask-user",
    "git:git@github.com:aposner2/pi-tools",
    "npm:pi-hindsight"
  ],
  "terminal": { "showTerminalProgress": true },
  "lastChangelogVersion": "0.83.0",
  "defaultThinkingLevel": "high",
  "hideThinkingBlock": false
}
```

### ~/.pi/agent/mcp.json

```json
{
  "mcpServers": {
    "mcp-searxng": {
      "url": "http://192.168.1.3:4005/mcp",
      "directTools": true
    },
    "hindsight": {
      "url": "http://192.168.1.4:8888/mcp/alex-ai-global/"
    }
  }
}
```

### ~/.pi/agent/models.json

| Provider | Base URL | API Type | Models Available |
|----------|----------|----------|-----------------|
| `lmstudio` | `http://192.168.1.2:1234/v1` | openai-completions | qwen3.6-27b-mtp (default, reasoning, 256K ctx), qwen/qwen3.6-27b, qwen/qwen3.6-35b-a3b, qwen/qwen3-coder-next, qwen2.5-coder-32b-instruct, google/gemma-4-31b, google/gemma-4-26b-a4b-qat, google/gemma-4-12b-qat, google/gemma-4-e4b |

**Compat settings:** `supportsDeveloperRole: false`, `supportsReasoningEffort: false`, `thinkingFormat: qwen-chat-template`

### ~/.hindsight/config

```ini
api_url = "http://192.168.1.4:8888"
global_bank = "alex-ai-global"
recall_types = "observation,experience"
recall_budget = "mid"
recall_max_tokens = 2048
async_retain = true
homedir_project = false
```

---

## 5. Tool Summary by Category

### File Operations (3)
| Tool | Source |
|------|--------|
| `read` | pi core |
| `edit` | pi core |
| `write` / `large_write` | pi core + pi-tools extension |

### System (2)
| Tool | Source |
|------|--------|
| `bash` | pi core |
| `sudo_auth` / `sudo_run` | pi-tools extension |

### Web (2)
| Tool | Source |
|------|--------|
| `search-web` | mcp-searxng MCP server |
| `fetch-web` | mcp-searxng MCP server |

### Memory — Extension Tools (3)
| Tool | Source |
|------|--------|
| `hindsight_recall` | pi-hindsight extension |
| `hindsight_retain` | pi-hindsight extension |
| `hindsight_reflect` | pi-hindsight extension |

### Memory — MCP Tools (28)
All from hindsight MCP server at 192.168.1.4:8888/mcp/alex-ai-global/

### User Interaction (1)
| Tool | Source |
|------|--------|
| `ask_user` | pi-ask-user extension (overrides pi core basic version) |

### MCP Orchestration (2)
| Tool | Source |
|------|--------|
| `mcp` | pi-mcp-adapter — server status, search, describe, auth, single tool calls |
| `mcpScript` | pi-mcp-adapter — batch JavaScript MCP orchestration |

### Reranking (1)
| Tool | Source |
|------|--------|
| `tei_rerank` | pi-tools extension |

---

## 6. Total Count

| Category | Count |
|----------|-------|
| Pi core built-in tools | 5 |
| Extension-registered tools | 8 (sudo_auth, sudo_run, large_write, tei_rerank, ask_user, hindsight_recall, hindsight_retain, hindsight_reflect) |
| MCP server tools (searxng) | 2 (search-web, fetch-web) |
| MCP server tools (hindsight) | 28 |
| **Total available tools** | **43** |

---

## 7. Network Dependencies

| Service | Host | Port | Required By |
|---------|------|------|-------------|
| LM Studio (LLM inference) | 192.168.1.2 (DGX Spark) | 1234 | All LLM calls, hindsight LLM provider |
| SearXNG MCP server | 192.168.1.3 | 4005 | search-web, fetch-web tools |
| Hindsight API + MCP | 192.168.1.4 (agents VM) | 8888 | All memory operations |
| TEI Embedder | 192.168.1.4 (Docker) | internal | Hindsight embeddings (via agents-net) |
| TEI Reranker | 192.168.1.4 (Docker) | internal | Hindsight reranking + tei_rerank tool |
