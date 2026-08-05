#!/usr/bin/env bash
# setup.sh — Deploy pi-tools config defaults into ~/.pi/agent/
# Idempotent: safe to re-run after `pi update --extensions`.
# Overwrites all configs UNLESS a .lock file exists (user customization).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_DIR="$SCRIPT_DIR/config"
PI_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
LOCK_DIR="$PI_DIR/.pi-lock"

# ── Colors ────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[pi-tools]${NC} $*"; }
ok()    { echo -e "${GREEN}[✓]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
error() { echo -e "${RED}[✗]${NC} $*" >&2; }

# ── Pre-flight checks ────────────────────────────────────
command -v jq >/dev/null 2>&1 || { error "jq is required. Install it first."; exit 1; }
[ -d "$PI_DIR" ] || { error "Pi not installed at $PI_DIR"; exit 1; }

# ── Check if a config file is locked ─────────────────────
is_locked() {
    local config_name="$1"
    [ -f "$LOCK_DIR/${config_name}.lock" ]
}

# ── Deploy one config file (overwrite unless locked) ─────
deploy_config() {
    local defaults_file="$1"
    local target_name="$2"       # e.g., "settings.json"
    local lock_name="$3"         # e.g., "settings"

    local target="$PI_DIR/$target_name"

    if is_locked "$lock_name"; then
        warn "$target_name is LOCKED — skipping (user customization preserved)"
        cat "$LOCK_DIR/${lock_name}.lock" | sed 's/^/   /'
        return 0
    fi

    # Validate JSON before writing
    if ! jq '.' "$defaults_file" >/dev/null 2>&1; then
        error "Invalid JSON: $defaults_file"
        return 1
    fi

    jq --sort-keys '.' "$defaults_file" > "$target"
    ok "Wrote $target_name"
}

# ── Install git hook (auto-run setup.sh after updates) ───
HOOKS_DIR="$SCRIPT_DIR/.git/hooks"
mkdir -p "$HOOKS_DIR"
if [ ! -f "$HOOKS_DIR/post-merge" ]; then
    cp "$SCRIPT_DIR/hooks/post-merge" "$HOOKS_DIR/post-merge"
    chmod +x "$HOOKS_DIR/post-merge"
    ok "Installed post-merge hook (auto-setup after pi update)"
elif [ "$SCRIPT_DIR/hooks/post-merge" -nt "$HOOKS_DIR/post-merge" ]; then
    cp "$SCRIPT_DIR/hooks/post-merge" "$HOOKS_DIR/post-merge"
    chmod +x "$HOOKS_DIR/post-merge"
    info "Updated post-merge hook"
fi

# ── Main ─────────────────────────────────────────────────
echo ""
info "pi-tools config setup (overwrite mode)"
info "  Config dir:   $CONFIG_DIR"
info "  Pi dir:       $PI_DIR"
info "  Lock dir:     $LOCK_DIR"
echo ""

# Ensure lock directory exists
mkdir -p "$LOCK_DIR"

deploy_config "$CONFIG_DIR/settings.defaults.json" "settings.json" "settings"
echo ""
deploy_config "$CONFIG_DIR/models.schema.json" "models.json" "models"
echo ""
deploy_config "$CONFIG_DIR/mcp.defaults.json" "mcp.json" "mcp"

echo ""
ok "Setup complete! Restart pi for changes to take effect."
info "Locked files were skipped. Use 'pi-config status' to see lock state."
