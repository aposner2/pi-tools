# pi-tools

Consolidated pi tools package: extensions, skills, prompts, and global config defaults for the pi coding agent.

## Quick Start — New Server

```bash
# 1. Install pi (if not already)
npm install -g @earendil-works/pi-coding-agent

# 2. Install this package
pi install git:git@github.com:aposner2/pi-tools

# 3. Run setup (creates .env.local from template on first run)
~/.pi/agent/git/github.com/aposner2/pi-tools/setup.sh

# 4. Edit .env.local with your server-specific values, then re-run
vi ~/.pi/agent/git/github.com/aposner2/pi-tools/config/.env.local
~/.pi/agent/git/github.com/aposner2/pi-tools/setup.sh
```

## Quick Start — Existing Server (merge)

If you already have a `~/.pi/agent/` config and want to layer pi-tools on top:

```bash
pi install git:git@github.com:aposner2/pi-tools
~/.pi/agent/git/github.com/aposner2/pi-tools/setup.sh
```

The setup script deep-merges defaults into your existing config. **On conflicting keys, it asks which version to keep.** Existing keys not in the defaults are preserved automatically.

## Updating

After changes are pushed to this repo:

```bash
pi update --extensions
~/.pi/agent/git/github.com/aposner2/pi-tools/setup.sh   # re-merge config
```

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

| File | Purpose |
|------|---------|
| `settings.defaults.json` | Theme, provider, model, packages, thinking level |
| `models.schema.json` | Provider definitions with model list (URLs from `.env.local`) |
| `mcp.defaults.json` | MCP server configuration (URLs from `.env.local`) |
| `.env.example` | Template for server-specific values — copy to `.env.local` |

Server-specific values (IP addresses, API keys) are read from `config/.env.local`. On first run of `setup.sh`, the template is copied automatically.

### Setup Script (`setup.sh`)

- Deep-merges defaults into existing `~/.pi/agent/settings.json`, `models.json`, and `mcp.json`
- **Asks on every conflict** — choose current, default, or manual merge
- Preserves keys that exist in your config but not in defaults
- Prompts to add new keys from defaults that don't exist yet
- Idempotent — safe to re-run after updates

## License

MIT
