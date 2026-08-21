# pi-tools

Consolidated pi tools package: extensions, skills, prompts, and global config defaults for the pi coding agent.

**Design principle:** pi-tools is the single source of truth for all pi agents on the network. Configs overwrite on update unless explicitly locked by the user.

## Quick Start — New Server

```bash
# 1. Install pi (if not already)
npm install -g @earendil-works/pi-coding-agent

# 2. Install this package
pi install git:git@github.com:aposner2/pi-tools

# 3. Run setup (overwrites all configs with hardcoded LAN values)
~/.pi/agent/git/github.com/aposner2/pi-tools/setup.sh
```

## Updating (Overwrite Mode)

After changes are pushed to this repo:

```bash
pi update --extensions
~/.pi/agent/git/github.com/aposner2/pi-tools/setup.sh   # overwrites configs (skips locked files)
```

**All three config files (`settings.json`, `models.json`, `mcp.json`) are overwritten with pi-tools defaults.** Locked files are skipped and preserved.

## Config Lock System

pi-tools manages three config files in `~/.pi/agent/`:

| File | Purpose | Overwritten? |
|------|---------|-------------|
| `settings.json` | Theme, provider, model, packages, thinking level | ✅ Unless locked |
| `models.json` | Provider definitions with model list (hardcoded LAN IPs) | ✅ Unless locked |
| `mcp.json` | MCP server configuration (hardcoded LAN IPs) | ✅ Unless locked |

### Lock/Unlock Workflow

```bash
# Check lock status of all files
pi-config status

# Lock a file (prevent overwrite on next update)
pi-config lock settings -r "Custom theme preference"

# Unlock a file (allow overwrite on next update)
pi-config unlock settings

# Edit a file and auto-lock after saving
pi-config edit mcp

# Revert to pi-tools defaults (auto-locks the reverted file)
pi-config revert models [commit-hash]

# Force overwrite even if locked
pi-config force settings

# See differences between current and pi-tools default
pi-config diff mcp
```

### Lock File Format

Locks live in `~/.pi/agent/.pi-lock/<name>.lock`:
```
# Locked: 2025-08-04 14:30:00
# Reason: Custom theme preference
# Commit: abc1234
```

When a file is locked, `setup.sh` skips it and shows the lock metadata. The file preserves its current state across updates until explicitly unlocked.

## Contents

### Extensions

| Extension | Description |
|-----------|-------------|
| `sudoer/` | Lets the agent run `sudo` commands by prompting for password via masked input. |
| `large-write/` | Write large files incrementally in chunks to avoid timeouts. |
| `hostname-badge/` | Shows hostname in pi's status bar for multi-server identification. |
| `model-update/` | Model update tracking and management. |

### Skills

| Skill | Description |
|-------|-------------|
| `init/` | Initialize or update AGENTS.md — analyzes codebase and generates a "readme for robots". |
| `large-write/` | Use `large_write` for files over 5KB to avoid timeouts. |
| `research/` | Systematic web research using SearXNG search and fetch tools. |

### Config Defaults (`config/`)

All config files use **hardcoded LAN IPs** — no `.env.local` or template variables needed:

| File | Purpose | Key Values |
|------|---------|------------|
| `settings.defaults.json` | Theme, provider, model, packages | `lmstudio`, `qwen3.6-27b-mtp` |
| `models.schema.json` | Provider definitions | LM Studio at `192.168.1.2:1234/v1` |
| `mcp.defaults.json` | MCP servers | hindsight → `192.168.1.4:8888`, searxng → `192.168.1.4:4005` |

### Setup Script (`setup.sh`)

- **Overwrites** all three config files with hardcoded defaults
- **Skips locked files** — shows lock metadata and preserves current state
- Installs git hook for auto-setup after `pi update --extensions`
- Idempotent — safe to re-run after updates
- **API keys** — resolves `HINDSIGHT_API_KEY` (required) / `LM_STUDIO_API_KEY` (optional) in order: env var → `.secrets/<name>.key` → interactive prompt. Prompt-entered keys are masked, validated live against the Hindsight API, and persisted to the gitignored `.secrets/` dir (chmod 600); env-provided keys are never persisted. Without a TTY the script fails fast with guidance (force this with `--non-interactive`).

### pi-config CLI Tool (`bin/pi-config`)

Manage config locks, reverts, and local customizations:
- `status` — show lock state of all config files
- `lock <file> [-r reason]` — prevent overwrite on next update
- `unlock <file>` — allow overwrite on next update
- `edit <file>` — open in editor, auto-lock after saving
- `revert <file> [commit]` — restore defaults from pi-tools (auto-locks)
- `force <file>` — overwrite even if locked
- `diff <file>` — compare current vs pi-tools default

## License

MIT
