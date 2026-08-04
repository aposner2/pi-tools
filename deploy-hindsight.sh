#!/usr/bin/env bash
# setup.sh — One-time deployment for new pi agent machines on LAN
# Usage: ./setup.sh [HINDSIGHT_HOST]
#   HINDSIGHT_HOST defaults to 192.168.1.4 (agents server)

set -euo pipefail

HINDSIGHT_HOST="${1:-192.168.1.4}"
HINDSIGHT_API_URL="http://${HINDSIGHT_HOST}:8888"
GLOBAL_BANK="alex-ai-global"
PI_TOOLS_REPO="git@github.com:aposner2/pi-tools"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

info()  { echo -e "${GREEN}[SETUP]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN ]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ── Prerequisites ────────────────────────────────────────────────
check_prereqs() {
    local missing=0
    for cmd in pi git curl; do
        if ! command -v "$cmd" &>/dev/null; then
            error "Required command not found: $cmd"
            missing=1
        fi
    done
    [ "$missing" -eq 0 ] || exit 1
    info "Prerequisites OK (pi, git, curl)"
}

# ── Step 1: Install pi-tools from git ────────────────────────────
install_pi_tools() {
    if pi list 2>/dev/null | grep -q "pi-tools"; then
        warn "pi-tools already installed — skipping"
        return 0
    fi

    info "Installing pi-tools from $PI_TOOLS_REPO ..."
    pi install "git:${PI_TOOLS_REPO}"
    info "pi-tools installed"
}

# ── Step 2: Install pi-hindsight npm package ─────────────────────
install_pi_hindsight() {
    if [ -d "$HOME/.pi/agent/npm/node_modules/pi-hindsight" ]; then
        warn "pi-hindsight already installed — skipping"
        return 0
    fi

    info "Installing pi-hindsight ..."
    pi install npm:pi-hindsight
    info "pi-hindsight installed"
}

# ── Step 3: Create ~/.hindsight/config ───────────────────────────
create_hindsight_config() {
    local config_dir="$HOME/.hindsight"
    local config_file="${config_dir}/config"

    if [ -f "$config_file" ]; then
        warn "~/.hindsight/config already exists — skipping (backed up as .config.bak)"
        cp "$config_file" "${config_file}.bak"
    fi

    mkdir -p "$config_dir"

    cat > "$config_file" <<EOF
api_url = "${HINDSIGHT_API_URL}"
global_bank = "${GLOBAL_BANK}"
recall_types = "observation,experience"
recall_budget = "mid"
recall_max_tokens = 2048
async_retain = true
homedir_project = false
EOF

    info "Created ~/.hindsight/config (api_url=${HINDSIGHT_API_URL})"
}

# ── Step 4: Configure Hindsight MCP server in pi ────────────────
configure_mcp() {
    local mcp_json="$HOME/.pi/agent/mcp.json"
    if [ ! -f "$mcp_json" ]; then
        warn "No $mcp_json found — skipping MCP config (not a pi agent machine?)"
        return 0
    fi

    # Check if hindsight MCP is already configured
    if grep -q '"hindsight"' "$mcp_json" 2>/dev/null; then
        warn "Hindsight MCP server already in $mcp_json — skipping"
        return 0
    fi

    info "Adding Hindsight MCP server to $mcp_json ..."
    # Use python for reliable JSON manipulation (no jq dependency)
    python3 -c "
import json, sys
with open('$mcp_json') as f:
    cfg = json.load(f)
cfg['mcpServers']['hindsight'] = {
    'url': '${HINDSIGHT_API_URL}/mcp/${GLOBAL_BANK}/'
}
with open('$mcp_json', 'w') as f:
    json.dump(cfg, f, indent=2)
    f.write('\\n')
"
    info "Hindsight MCP configured at ${HINDSIGHT_API_URL}/mcp/${GLOBAL_BANK}/"
}

# ── Step 5: Verify hindsight API is reachable ────────────────────
verify_hindsight() {
    info "Verifying Hindsight API at ${HINDSIGHT_API_URL}/health ..."
    local status
    status=$(curl -sf --connect-timeout 5 "${HINDSIGHT_API_URL}/health" 2>/dev/null) || true

    if [ -n "$status" ]; then
        info "Hindsight API is reachable: $status"
    else
        warn "Could not reach Hindsight API at ${HINDSIGHT_API_URL}/health"
        warn "Make sure the hindsight stack is running on ${HINDSIGHT_HOST}:"
        warn "  ssh ${HINDSIGHT_HOST} 'cd ~/docker/hindsight && sudo docker compose up -d'"
    fi
}

# ── Main ─────────────────────────────────────────────────────────
main() {
    echo ""
    info "=== Pi Agent Machine Setup ==="
    info "Target: $(hostname) | Hindsight host: ${HINDSIGHT_HOST}"
    echo ""

    check_prereqs
    install_pi_tools
    install_pi_hindsight
    create_hindsight_config
    configure_mcp
    verify_hindsight

    echo ""
    info "=== Setup complete ==="
    info "Config: ~/.hindsight/config"
    info "API URL: ${HINDSIGHT_API_URL}"
    info "Global bank: ${GLOBAL_BANK}"
    echo ""
}

main "$@"
