#!/usr/bin/env bash
# setup.sh — one-command onboarding for unified-lab pi machines (unified-memory Phase 3)
#
# Usage:
#   bash setup.sh [HINDSIGHT_HOST]             full onboarding (idempotent — safe to re-run)
#   bash setup.sh --verify [HINDSIGHT_HOST]    verify + drift check only (makes NO changes)
#   HINDSIGHT_HOST defaults to 192.168.1.4
#   Env overrides: LM_HOST (default 192.168.1.2), GLOBAL_BANK (default alex-ai-global)
#
# Full mode:
#   1. Installs pi packages: pi-tools (git) + pi-hindsight (npm)
#   2. Syncs the active pi-tools clone to latest (installs the post-merge hook)
#   3. Deploys the 5 canonical artifacts (backing up anything that differs first):
#        ~/.pi/agent/APPEND_SYSTEM.md  -> symlink into the clone (single source of truth)
#        ~/.pi/agent/mcp.json          <- config/mcp.defaults.json
#        ~/.pi/agent/settings.json     <- config/settings.defaults.json (keeps pi-managed fields)
#        ~/.pi/agent/models.json       <- config/models.schema.json
#        ~/.hindsight/config           <- config/hindsight.config
#   4. Records this machine in config/machines.json (lab registry)
#   5. Runs the verification checklist (health + MCP handshakes + drift)
#
# Escape hatches:
#   - A lock file at $PI_DIR/.pi-lock/<name>.lock skips a file (user customization preserved)
#     Lock names: APPEND_SYSTEM | mcp | settings | models | hindsight
#   - Pre-existing differing files are backed up to ~/unified-memory-backup-<date>/ first

set -euo pipefail

# ── Arguments ─────────────────────────────────────────────────────
VERIFY_ONLY=0
POSITIONAL=()
for a in "$@"; do
  case "$a" in
    --verify) VERIFY_ONLY=1 ;;
    *) POSITIONAL+=("$a") ;;
  esac
done
HINDSIGHT_HOST="${POSITIONAL[0]:-192.168.1.4}"
LM_HOST="${LM_HOST:-192.168.1.2}"
GLOBAL_BANK="${GLOBAL_BANK:-alex-ai-global}"
DEF_HS="192.168.1.4"; DEF_LM="192.168.1.2"

PI_TOOLS_REPO="git@github.com:aposner2/pi-tools"
PI_TOOLS_SLUG="github.com/aposner2/pi-tools"
PI_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
CLONE="$HOME/.pi/agent/git/$PI_TOOLS_SLUG"

# ── Logging ───────────────────────────────────────────────────────
if [ -t 1 ]; then
  RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; CYAN=$'\033[0;36m'; NC=$'\033[0m'
else
  RED=""; GREEN=""; YELLOW=""; CYAN=""; NC=""
fi
info()  { echo -e "${CYAN}[pi-tools]${NC} $*"; }
ok()    { echo -e "${GREEN}[✓]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
error() { echo -e "${RED}[✗]${NC} $*" >&2; }

# ── Prerequisites ─────────────────────────────────────────────────
check_prereqs() {
  local missing=0
  for cmd in git curl python3; do
    command -v "$cmd" >/dev/null 2>&1 || { error "required command missing: $cmd"; missing=1; }
  done
  if [ "$missing" -ne 0 ]; then exit 1; fi
  if ! command -v pi >/dev/null 2>&1; then
    error "pi CLI not found. Install pi first (Node.js required), then re-run setup.sh."
    exit 1
  fi
  [ -d "$PI_DIR" ] || { error "pi agent dir not found: $PI_DIR (has pi been started once?)"; exit 1; }
  ok "prerequisites OK (pi, git, curl, python3)"
}

# ── Packages ──────────────────────────────────────────────────────
install_packages() {
  local pi_list
  pi_list="$(pi list 2>/dev/null || true)"
  if echo "$pi_list" | grep -qi "pi-tools"; then
    ok "pi-tools package present"
  else
    info "installing pi-tools package ..."
    pi install "git:${PI_TOOLS_REPO}" || warn "pi install pi-tools reported an issue (continuing — may already be installed)"
  fi
  if [ -d "$PI_DIR/npm/node_modules/pi-hindsight" ]; then
    ok "pi-hindsight package present"
  else
    info "installing pi-hindsight package ..."
    pi install npm:pi-hindsight || warn "pi install pi-hindsight reported an issue (continuing — may already be installed)"
  fi
}

# ── Clone sync + hook ─────────────────────────────────────────────
sync_clone() {
  if [ ! -d "$CLONE/.git" ]; then
    info "cloning pi-tools to $CLONE ..."
    mkdir -p "$(dirname "$CLONE")"
    git clone "$PI_TOOLS_REPO" "$CLONE"
  fi
  info "updating clone ..."
  ( cd "$CLONE" && git fetch origin && git merge --ff-only origin/master ) \
    || warn "clone update failed — continuing with local clone state"
  local HOOKS_DIR="$CLONE/.git/hooks"
  mkdir -p "$HOOKS_DIR"
  if [ ! -f "$HOOKS_DIR/post-merge" ] || [ "$CLONE/hooks/post-merge" -nt "$HOOKS_DIR/post-merge" ]; then
    cp "$CLONE/hooks/post-merge" "$HOOKS_DIR/post-merge"
    chmod +x "$HOOKS_DIR/post-merge"
    ok "post-merge hook installed/updated"
  else
    ok "post-merge hook current"
  fi
}

# ── Deployment helpers ────────────────────────────────────────────
locked() { [ -f "$PI_DIR/.pi-lock/$1.lock" ]; }

maybe_backup() {
  local f="$1"
  if [ -e "$f" ] && [ ! -L "$f" ]; then
    local B="$HOME/unified-memory-backup-$(date +%Y%m%d)"
    mkdir -p "$B"
    cp -p "$f" "$B/$(basename "$f")"
    info "backed up existing $(basename "$f") -> $B/"
  fi
}

# Canonical file content with lab-host substitution applied (no-op when hosts are default)
stage_file() {
  local src="$1" out
  out="$(mktemp)"
  sed -e "s|http://$DEF_HS:8888|http://$HINDSIGHT_HOST:8888|g" \
      -e "s|http://$DEF_LM:1234|http://$LM_HOST:1234|g" "$src" > "$out"
  echo "$out"
}

deploy_file() { # <staged-src> <target> <lockname>
  local src="$1" target="$2" lock="$3"
  if locked "$lock"; then
    warn "$(basename "$target") is LOCKED — skipped (user customization preserved)"
    return 0
  fi
  if [ -f "$target" ] && cmp -s "$src" "$target"; then
    ok "$(basename "$target") already canonical — no-op"
    return 0
  fi
  maybe_backup "$target"
  install -m 644 "$src" "$target"
  ok "$(basename "$target") updated"
}

deploy_append() {
  local src="$CLONE/APPEND_SYSTEM.md" target="$PI_DIR/APPEND_SYSTEM.md"
  if [ -L "$target" ] && [ "$(readlink "$target")" = "$src" ]; then
    ok "APPEND_SYSTEM.md already symlinked to canonical"
    return 0
  fi
  if locked "APPEND_SYSTEM"; then
    warn "APPEND_SYSTEM.md is LOCKED — skipped (user customization preserved)"
    return 0
  fi
  if [ -e "$target" ] && [ ! -L "$target" ]; then
    maybe_backup "$target"; rm "$target"
  fi
  ln -sfn "$src" "$target"
  ok "APPEND_SYSTEM.md -> $src"
}

deploy_settings() {
  local staged lcv
  staged="$(stage_file "$CLONE/config/settings.defaults.json")"
  # Preserve the pi-managed changelog marker if the live file has one
  if [ -f "$PI_DIR/settings.json" ]; then
    lcv="$(python3 -c '
import json, sys
try:
    print(json.load(open(sys.argv[1])).get("lastChangelogVersion", ""))
except Exception:
    print("")
' "$PI_DIR/settings.json" 2>/dev/null || true)"
    if [ -n "$lcv" ]; then
      python3 -c '
import json, sys
p = sys.argv[1]
d = json.load(open(p))
d["lastChangelogVersion"] = sys.argv[2]
json.dump(d, open(p, "w"), indent=2)
open(p, "a").write("\n")
' "$staged" "$lcv"
    fi
  fi
  deploy_file "$staged" "$PI_DIR/settings.json" "settings"
  rm -f "$staged"
}

deploy_hindsight_config() {
  local staged
  staged="$(stage_file "$CLONE/config/hindsight.config")"
  if locked "hindsight"; then
    warn "~/.hindsight/config is LOCKED — skipped"; rm -f "$staged"; return 0
  fi
  mkdir -p "$HOME/.hindsight"
  local target="$HOME/.hindsight/config"
  if [ -f "$target" ] && cmp -s "$staged" "$target"; then
    ok "~/.hindsight/config already canonical — no-op"; rm -f "$staged"; return 0
  fi
  maybe_backup "$target"
  install -m 644 "$staged" "$target"
  ok "~/.hindsight/config updated"
  rm -f "$staged"
}


# ── Registry ──────────────────────────────────────────────────────
register_machine() {
  local reg="$CLONE/config/machines.json"
  local hn ip
  hn="$(hostname)"
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  local action
  action="$(python3 - "$reg" "$hn" "$ip" "$(date -u +%F)" <<'PY'
import json, os, sys
reg, hn, ip, ts = sys.argv[1:5]
d = {"machines": []}
if os.path.exists(reg):
    d = json.load(open(reg))
ms = d.setdefault("machines", [])
m = next((x for x in ms if x.get("hostname") == hn), None)
if m is None:
    ms.append({"hostname": hn, "ip": ip, "role": "member",
               "onboarded": ts, "status": "unified"})
    action = "registered"
else:
    m.update({"ip": ip, "last_verified": ts, "status": "unified"})
    action = "updated"
json.dump(d, open(reg, "w"), indent=2)
open(reg, "a").write("\n")
print(action)
PY
)"
  ok "registry: $hn $action ($ip)"
  info "NOTE: registry change is local to this clone — commit+push it to share lab-wide"
}

# ── Verification ──────────────────────────────────────────────────
mcp_handshake() { # <url>
  local url="$1" resp
  resp="$(curl -s -m 8 -X POST "$url" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"setup.sh","version":"2.0"}}}' \
    2>/dev/null || true)"
  echo "$resp" | grep -q "serverInfo\|protocolVersion"
}

verify_all() {
  local fails=0
  echo ""
  info "=== Verification checklist ($(hostname)) ==="

  if curl -sf -m 8 "http://$HINDSIGHT_HOST:8888/health" 2>/dev/null | grep -q "healthy"; then
    ok "Hindsight healthy at $HINDSIGHT_HOST:8888"
  else
    warn "Hindsight NOT reachable/healthy at $HINDSIGHT_HOST:8888"; fails=$((fails+1))
  fi

  if curl -sf -m 8 "http://$LM_HOST:1234/v1/models" 2>/dev/null | grep -q '"data"'; then
    ok "LM Studio serving models at $LM_HOST:1234"
  else
    warn "LM Studio NOT reachable at $LM_HOST:1234"; fails=$((fails+1))
  fi

  if mcp_handshake "http://$HINDSIGHT_HOST:8888/mcp/$GLOBAL_BANK/"; then
    ok "MCP handshake OK: hindsight ($GLOBAL_BANK)"
  else
    warn "MCP handshake FAILED: hindsight"; fails=$((fails+1))
  fi

  if mcp_handshake "http://$HINDSIGHT_HOST:4005/mcp/"; then
    ok "MCP handshake OK: mcp-searxng"
  else
    warn "MCP handshake FAILED: mcp-searxng"; fails=$((fails+1))
  fi

  # Drift check: live configs vs canonical (host-substituted), settings ignores pi-managed field
  info "drift check (live vs canonical) ..."
  local drift
  drift="$(python3 - "$CLONE" "$PI_DIR" "$HOME" "$HINDSIGHT_HOST" "$LM_HOST" <<'PY'
import json, os, sys
clone, pidir, home, hs, lm = sys.argv[1:6]
DHS, DLM = "192.168.1.4", "192.168.1.2"
def sub(t):
    return (t.replace("http://%s:8888" % DHS, "http://%s:8888" % hs)
             .replace("http://%s:1234" % DLM, "http://%s:1234" % lm))
def canon_json(rel):
    return json.loads(sub(open(os.path.join(clone, rel)).read()))
def live_json(rel):
    return json.load(open(os.path.join(pidir, rel)))
bad = 0
for live_rel, can_rel, ignore in [
    ("mcp.json", "config/mcp.defaults.json", set()),
    ("settings.json", "config/settings.defaults.json", {"lastChangelogVersion"}),
    ("models.json", "config/models.schema.json", set()),
]:
    try:
        c, l = canon_json(can_rel), live_json(live_rel)
    except Exception as e:
        print("ERR  %s (%s)" % (live_rel, e)); bad = 1; continue
    for k in ignore:
        c.pop(k, None); l.pop(k, None)
    if c == l:
        print("OK   " + live_rel)
    else:
        print("DRIFT " + live_rel); bad = 1
try:
    hcan = sub(open(os.path.join(clone, "config/hindsight.config")).read())
    hlive = open(os.path.join(home, ".hindsight/config")).read()
    print("OK   .hindsight/config" if hcan == hlive else "DRIFT .hindsight/config")
    bad |= (hcan != hlive)
except Exception as e:
    print("ERR  .hindsight/config (%s)" % e); bad = 1
t = os.path.join(pidir, "APPEND_SYSTEM.md")
src = os.path.join(clone, "APPEND_SYSTEM.md")
if os.path.islink(t) and os.readlink(t) == src and open(t).read() == open(src).read():
    print("OK   APPEND_SYSTEM.md (symlink -> canonical)")
else:
    print("DRIFT APPEND_SYSTEM.md (not symlinked to canonical)"); bad = 1
sys.exit(bad)
PY
)" || true
  echo "$drift" | sed 's/^/     /'
  if echo "$drift" | grep -q "^DRIFT\|^ERR\|Traceback"; then
    warn "drift detected (see above)"; fails=$((fails+1))
  else
    ok "drift check clean"
  fi

  echo ""
  if [ "$fails" -eq 0 ]; then
    ok "ALL CHECKS PASSED"
  else
    warn "$fails check(s) failed"
  fi
  [ "$fails" -eq 0 ]
}

# ── Main ──────────────────────────────────────────────────────────
main() {
  echo ""
  info "=== unified-lab pi onboarding ($(hostname)) ==="
  info "  hindsight: http://$HINDSIGHT_HOST:8888 (bank: $GLOBAL_BANK)"
  info "  lmstudio : http://$LM_HOST:1234/v1"
  echo ""
  check_prereqs

  if [ "$VERIFY_ONLY" -eq 1 ]; then
    verify_all
    exit $?
  fi

  install_packages
  sync_clone

  echo ""
  info "deploying canonical artifacts ..."
  deploy_append
  local staged
  staged="$(stage_file "$CLONE/config/mcp.defaults.json")"
  deploy_file "$staged" "$PI_DIR/mcp.json" "mcp"; rm -f "$staged"
  deploy_settings
  staged="$(stage_file "$CLONE/config/models.schema.json")"
  deploy_file "$staged" "$PI_DIR/models.json" "models"; rm -f "$staged"
  deploy_hindsight_config

  register_machine

  verify_all || true

  echo ""
  ok "Setup complete on $(hostname)."
  info "Start a fresh pi session (or /reload) for config changes to take effect."
  info "Re-run any time with:  bash setup.sh --verify   (no changes, checks only)"
}

main "$@"
