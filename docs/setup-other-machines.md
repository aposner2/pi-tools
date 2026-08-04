# Setting Up a New Pi Agent Machine on LAN

This guide walks through the one-time setup required for any new machine that will run pi agents and connect to the shared Hindsight memory service.

## Quick Start (One Command)

```bash
curl -sL https://raw.githubusercontent.com/aposner2/pi-tools/main/setup.sh | bash -s 192.168.1.4
```

Replace `192.168.1.4` with your Hindsight server's IP if different.

## Manual Steps

### Prerequisites

Make sure the following are installed:
- **pi** (the pi coding agent)
- **git**
- **curl**

### Step 1 — Install pi-tools

```bash
pi install git:git@github.com:aposner2/pi-tools
```

This installs shared extensions (chat, sudoer, large-write), skills (init, research, sys-scan, etc.), and prompt templates.

### Step 2 — Run setup.sh

From the cloned repo:

```bash
cd ~/pi-tools
chmod +x setup.sh
./setup.sh [HINDSIGHT_HOST]
```

Where `HINDSIGHT_HOST` defaults to `192.168.1.4`. This handles steps 2–3 below automatically.

### Step 3 — Install pi-hindsight

```bash
pi install npm:pi-hindsight
```

This installs the Hindsight memory extension and skill for pi agents.

### Step 4 — Configure ~/.hindsight/config

Create `~/.hindsight/config` with these settings:

```ini
api_url = "http://192.168.1.4:8888"
global_bank = "alex-ai-global"
recall_types = "observation,experience"
recall_budget = "mid"
recall_max_tokens = 2048
async_retain = true
homedir_project = false
```

| Setting | Purpose |
|---------|---------|
| `api_url` | Hindsight REST API endpoint (agents server) |
| `global_bank` | Shared memory bank name across all machines |
| `recall_types` | Which memory types to retrieve (`observation`, `experience`) |
| `recall_budget` | Retrieval depth: `low`, `mid`, or `high` |
| `recall_max_tokens` | Max tokens returned per recall (2048) |
| `async_retain` | Retain memories in background without blocking |
| `homedir_project` | Whether to create a project-scoped memory bank from homedir |

### Step 5 — Configure Hindsight MCP Server (automatic via setup.sh)

The `setup.sh` script automatically adds the Hindsight MCP server to `~/.pi/agent/mcp.json`. This gives pi agents direct access to hindsight tools (retain, recall, reflect) via MCP.

Manual config if needed:
```json
{
  "mcpServers": {
    "hindsight": {
      "url": "http://192.168.1.4:8888/mcp/alex-ai-global/"
    }
  }
}
```

> **Note:** A pi agent restart is required after adding the MCP server for it to take effect.

### Step 6 — Verify

```bash
curl http://192.168.1.4:8888/health
```

Should return a JSON health status. If not, ensure the Hindsight stack is running on the agents server:

```bash
ssh 192.168.1.4 'cd ~/docker/hindsight && sudo docker compose up -d'
```

## Architecture Overview

```
┌──────────────────────┐         ┌─────────────────────────┐
│  New Agent Machine   │         │    agents (192.168.1.4)  │
│                      │         │                          │
│  pi + pi-tools       │────────►│  Hindsight API :8888     │
│  pi-hindsight        │  LAN    │  Control Plane UI :9999  │
│  ~/.hindsight/config │         │  TEI Embedder/Reranker   │
└──────────────────────┘         └─────────────────────────┘
```

All agent machines share the same `global_bank` (`alex-ai-global`) so memories are consistent across the fleet.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `pi: command not found` | Install pi first: follow [pi installation guide](https://github.com/earendil-works/pi-coding-agent) |
| Hindsight API unreachable | Check that `sudo docker compose up -d` is running on 192.168.1.4 in `~/docker/hindsight/` |
| SSH key errors | Run `ssh-copy-id aposner@192.168.1.4` to set up passwordless auth |
| Config not picked up | Restart the pi agent session after creating `~/.hindsight/config` |
