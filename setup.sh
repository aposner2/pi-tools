#!/usr/bin/env bash
# setup.sh — Merge pi-tools config defaults into ~/.pi/agent/
# Idempotent: safe to re-run after `pi update --extensions`.
# On conflicting keys, asks which version to keep.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_DIR="$SCRIPT_DIR/config"
PI_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"

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

# ── Load env vars ────────────────────────────────────────
ENV_FILE="$CONFIG_DIR/.env.local"
if [ ! -f "$ENV_FILE" ]; then
    info "No .env.local found. Copying template — please edit it first."
    cp "$CONFIG_DIR/.env.example" "$ENV_FILE"
    warn "Created $ENV_FILE"
    echo "   Edit it with your server-specific values, then re-run:"
    echo "   $ bash \"$0\""
    exit 1
fi

# shellcheck disable=SC1091
source "$ENV_FILE"

# Validate required vars
for var in DEFAULT_PROVIDER DEFAULT_MODEL PROVIDER_NAME BASE_URL API_KEY MCP_SEARXNG_URL; do
    if [ -z "${!var:-}" ]; then
        error "Variable $var is not set in .env.local"
        exit 1
    fi
done

# ── Resolve templates (substitute {{VARS}}) ──────────────
resolve() {
    local template="$1"
    sed \
        -e "s|{{DEFAULT_PROVIDER}}|$DEFAULT_PROVIDER|g" \
        -e "s|{{DEFAULT_MODEL}}|$DEFAULT_MODEL|g" \
        -e "s|{{PROVIDER_NAME}}|$PROVIDER_NAME|g" \
        -e "s|{{BASE_URL}}|$BASE_URL|g" \
        -e "s|{{API_KEY}}|$API_KEY|g" \
        -e "s|{{MCP_SEARXNG_URL}}|$MCP_SEARXNG_URL|g" \
        "$template" | jq '.' 2>/dev/null || { error "Invalid JSON after substitution: $template"; exit 1; }
}

# ── Conflict resolution helper ───────────────────────────
# Compares two JSON values at a given path. On conflict, asks user.
# Returns the chosen value (stdout).
resolve_conflict() {
    local path="$1"
    local existing="$2"
    local default_val="$3"

    # If values are identical, no conflict
    if [ "$existing" = "$default_val" ]; then
        echo "$existing"
        return 0
    fi

    echo ""
    warn "Conflict at $path"
    echo -e "   ${RED}Current:${NC}"
    echo "$existing" | head -5 | sed 's/^/     /'
    echo -e "   ${GREEN}pi-tools default:${NC}"
    echo "$default_val" | head -5 | sed 's/^/     /'
    echo ""
    while true; do
        read -rp "   Keep [c]urrent, use [d]efault, or [m]erge (show both)? " choice
        case "$choice" in
            c|C) echo "$existing"; return 0 ;;
            d|D) echo "$default_val"; return 0 ;;
            m|M)
                echo ""
                echo -e "   ${RED}Current:${NC}"
                echo "$existing" | sed 's/^/     /'
                echo ""
                echo -e "   ${GREEN}Default:${NC}"
                echo "$default_val" | sed 's/^/     /'
                echo ""
                read -rp "   Paste your merged value (JSON) or type 'skip' to keep current: " merged
                if [ "$merged" = "skip" ]; then
                    echo "$existing"; return 0
                fi
                # Validate JSON
                if echo "$merged" | jq '.' >/dev/null 2>&1; then
                    echo "$merged"
                    return 0
                else
                    error "Invalid JSON. Try again."
                fi
                ;;
            *) error "Type c, d, or m";;
        esac
    done
}

# ── Merge settings.json ──────────────────────────────────
merge_settings() {
    local defaults_file="$CONFIG_DIR/settings.defaults.json"
    local target="$PI_DIR/settings.json"
    local resolved
    resolved="$(resolve "$defaults_file")"

    if [ ! -f "$target" ]; then
        info "No existing settings.json — writing defaults."
        echo "$resolved" | jq --sort-keys '.' > "$target"
        ok "Created $target"
        return 0
    fi

    local existing
    existing="$(cat "$target")"
    local has_conflicts=false
    local merged="$existing"

    # Compare top-level keys from defaults against existing
    for key in $(echo "$resolved" | jq -r 'keys[]'); do
        local exists_in_current
        exists_in_current="$(echo "$existing" | jq --arg k "$key" 'has($k)')"

        if [ "$exists_in_current" = "true" ]; then
            local current_val default_val
            current_val="$(echo "$existing" | jq -c --arg k "$key" '.[$k]')"
            default_val="$(echo "$resolved" | jq -c --arg k "$key" '.[$k]')"

            if [ "$current_val" != "$default_val" ]; then
                has_conflicts=true
                local chosen
                chosen="$(resolve_conflict "settings.$key" "$current_val" "$default_val")"
                merged="$(echo "$merged" | jq --arg k "$key" --argjson v "$chosen" '.[$k] = $v')"
            fi
        else
            # Key exists in defaults but not current — ask if we should add it
            local default_val
            default_val="$(echo "$resolved" | jq -c --arg k "$key" '.[$k]')"
            echo ""
            warn "New key '$key' from pi-tools (not in current settings)"
            echo -e "   ${GREEN}Value:${NC}"
            echo "$default_val" | head -3 | sed 's/^/     /'
            read -rp "   Add it? [Y/n] " add_it
            if [[ ! "$add_it" =~ ^[Nn]$ ]]; then
                merged="$(echo "$merged" | jq --arg k "$key" --argjson v "$default_val" '.[$k] = $v')"
                ok "Added settings.$key"
            else
                info "Skipping settings.$key"
            fi
        fi
    done

    if [ "$has_conflicts" = true ] || ! diff -q <(echo "$existing" | jq --sort-keys '.') <(echo "$merged" | jq --sort-keys '.') >/dev/null 2>&1; then
        echo "$merged" | jq --sort-keys '.' > "$target"
        ok "Updated $target"
    else
        info "No changes needed for settings.json"
    fi
}

# ── Merge models.json ────────────────────────────────────
merge_models() {
    local defaults_file="$CONFIG_DIR/models.schema.json"
    local target="$PI_DIR/models.json"
    local resolved
    resolved="$(resolve "$defaults_file")"

    if [ ! -f "$target" ]; then
        info "No existing models.json — writing defaults."
        echo "$resolved" | jq --sort-keys '.' > "$target"
        ok "Created $target"
        return 0
    fi

    local existing
    existing="$(cat "$target")"

    # Compare provider-by-provider
    for provider in $(echo "$resolved" | jq -r '.providers | keys[]'); do
        local exists_in_current
        exists_in_current="$(echo "$existing" | jq --arg p "$provider" '.providers | has($p)')"

        if [ "$exists_in_current" = "true" ]; then
            local current_provider default_provider
            current_provider="$(echo "$existing" | jq -c --arg p "$provider" '.providers[$p]')"
            default_provider="$(echo "$resolved" | jq -c --arg p "$provider" '.providers[$p]')"

            if [ "$current_provider" != "$default_provider" ]; then
                local chosen
                chosen="$(resolve_conflict "models.providers.$provider" "$current_provider" "$default_provider")"
                existing="$(echo "$existing" | jq --arg p "$provider" --argjson v "$chosen" '.providers[$p] = $v')"
            else
                info "Provider '$provider' unchanged"
            fi
        else
            local default_provider
            default_provider="$(echo "$resolved" | jq -c --arg p "$provider" '.providers[$p]')"
            echo ""
            warn "New provider '$provider' from pi-tools"
            read -rp "   Add it? [Y/n] " add_it
            if [[ ! "$add_it" =~ ^[Nn]$ ]]; then
                existing="$(echo "$existing" | jq --arg p "$provider" --argjson v "$default_provider" '.providers[$p] = $v')"
                ok "Added provider '$provider'"
            else
                info "Skipping provider '$provider'"
            fi
        fi
    done

    # Check for providers in current but not in defaults (preserve them)
    for provider in $(echo "$existing" | jq -r '.providers // {} | keys[]'); do
        local in_defaults
        in_defaults="$(echo "$resolved" | jq --arg p "$provider" '.providers | has($p)')"
        if [ "$in_defaults" = "false" ]; then
            info "Preserving existing provider '$provider' (not in pi-tools defaults)"
        fi
    done

    echo "$existing" | jq --sort-keys '.' > "$target"
    ok "Updated $target"
}

# ── Merge mcp.json ───────────────────────────────────────
merge_mcp() {
    local defaults_file="$CONFIG_DIR/mcp.defaults.json"
    local target="$PI_DIR/mcp.json"
    local resolved
    resolved="$(resolve "$defaults_file")"

    if [ ! -f "$target" ]; then
        info "No existing mcp.json — writing defaults."
        echo "$resolved" | jq --sort-keys '.' > "$target"
        ok "Created $target"
        return 0
    fi

    local existing
    existing="$(cat "$target")"

    for server in $(echo "$resolved" | jq -r '.mcpServers | keys[]'); do
        local exists_in_current
        exists_in_current="$(echo "$existing" | jq --arg s "$server" '.mcpServers | has($s)')"

        if [ "$exists_in_current" = "true" ]; then
            local current_server default_server
            current_server="$(echo "$existing" | jq -c --arg s "$server" '.mcpServers[$s]')"
            default_server="$(echo "$resolved" | jq -c --arg s "$server" '.mcpServers[$s]')"

            if [ "$current_server" != "$default_server" ]; then
                local chosen
                chosen="$(resolve_conflict "mcp.mcpServers.$server" "$current_server" "$default_server")"
                existing="$(echo "$existing" | jq --arg s "$server" --argjson v "$chosen" '.mcpServers[$s] = $v')"
            else
                info "MCP server '$server' unchanged"
            fi
        else
            local default_server
            default_server="$(echo "$resolved" | jq -c --arg s "$server" '.mcpServers[$s]')"
            echo ""
            warn "New MCP server '$server' from pi-tools"
            read -rp "   Add it? [Y/n] " add_it
            if [[ ! "$add_it" =~ ^[Nn]$ ]]; then
                existing="$(echo "$existing" | jq --arg s "$server" --argjson v "$default_server" '.mcpServers[$s] = $v')"
                ok "Added MCP server '$server'"
            else
                info "Skipping MCP server '$server'"
            fi
        fi
    done

    echo "$existing" | jq --sort-keys '.' > "$target"
    ok "Updated $target"
}

# ── Main ─────────────────────────────────────────────────
echo ""
info "pi-tools config setup"
info "  Config dir:   $CONFIG_DIR"
info "  Pi dir:       $PI_DIR"
info "  Env file:     $ENV_FILE"
echo ""

merge_settings
echo ""
merge_models
echo ""
merge_mcp

echo ""
ok "Setup complete! Restart pi for changes to take effect."
info "To update after a pi-tools change:"
info "  pi update --extensions && bash \"$0\""
