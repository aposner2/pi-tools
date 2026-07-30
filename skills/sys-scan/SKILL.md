---
name: sys-scan
description: >-
  Scans the system and produces a concise information card about hardware, OS,
  and environment. Writes results to ~/.pi/sys-scan.md so they are available
  across sessions. Use when the user asks about the machine, hardware specs,
  operating system, CPU, RAM, disk, GPU, or anything related to the host
  environment.
---

# Sys-Scan Skill

Produce a concise, structured system information card and persist it to
`~/.pi/sys-scan.md`. This file is referenced by `APPEND_SYSTEM.md` so the
agent can answer system questions without re-running commands every time.

## Workflow

### 1 — Gather Information

Run these commands (suppress errors gracefully):

```bash
# OS & Kernel
cat /etc/os-release | grep -E 'PRETTY_NAME|VERSION_ID'
uname -rsm
hostname

# CPU
grep -m1 'model name' /proc/cpuinfo | cut -d: -f2 | xargs
echo "Cores: $(grep 'core id' /proc/cpuinfo | sort -u | wc -l), Threads: $(nproc)"
uname -m

# Memory & Swap
free -h | grep -E 'Mem|Swap'

# Disk (root)
df -h /

# GPU
lspci 2>/dev/null | grep -i vga || echo "No VGA detected"
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader 2>/dev/null || true
```

### 2 — Write the Card

Write `~/.pi/sys-scan.md` using this format:

```markdown
# System Scan — <hostname>

*Generated: <ISO-8601 timestamp>*

## OS
| Field | Value |
|-------|-------|
| Distribution | <PRETTY_NAME> |
| Kernel | <kernel version arch> |
| Hostname | <hostname> |

## CPU
| Field | Value |
|-------|-------|
| Model | <cpu model> |
| Architecture | <arch> |
| Physical Cores | <cores> |
| Threads | <threads> |

## Memory
| Field | Value |
|-------|-------|
| Total RAM | <total> |
| Swap | <swap info> |

## Disk (`/`)
| Field | Value |
|-------|-------|
| Filesystem | <device> |
| Size | <size> |
| Used | <used> (<pct>) |
| Available | <avail> |

## GPU
<GPU details or "No dedicated GPU detected">
```

### 3 — Ensure APPEND_SYSTEM.md References It

Check `~/.pi/agent/APPEND_SYSTEM.md`. If it does **not** contain a reference to
`sys-scan.md`, append this block:

```markdown
## System Information

When the user asks about the system, hardware, OS, or environment this agent is
running on, read `~/.pi/sys-scan.md` for a concise overview. If the information
seems stale (older than 7 days) or the user needs details not covered there, run
fresh commands to update it.
```

### 4 — Report Back

Summarize the key specs in your response so the user sees them immediately:

> **System:** <hostname> — <OS>, <CPU cores/threads>, <RAM>, <disk avail>, <GPU>

## Rules

- **Always write to `~/.pi/sys-scan.md`** (not a project-local path) so it's
  shared across all sessions.
- **Include the timestamp** so staleness can be assessed later.
- **Keep it concise.** Use tables, not paragraphs. One card per system.
- **Handle missing tools gracefully.** If `lspci`, `nvidia-smi`, or `free` are
  unavailable, note that rather than failing.
- **Overwrite the file** on each scan — don't append multiple cards.
