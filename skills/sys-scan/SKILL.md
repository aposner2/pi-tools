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

### 0 — Check for Existing Scan

Before running any commands, check whether a previous scan already exists:

```bash
test -f ~/.pi/sys-scan.md && echo "EXISTS" || echo "MISSING"
```

- **If the file does NOT exist** → proceed to Step 1.
- **If the file EXISTS** → read it, note its timestamp, and use `ask_user` to present:

> A system scan already exists (`~/.pi/sys-scan.md`, generated: `<timestamp>`). Would you like to re-run the scan or use the existing information?

  - **Re-run scan** — proceed to Step 1.
  - **Use existing scan** — read `~/.pi/sys-scan.md` and report its contents directly. Skip all remaining steps.

### 1 — Detect Platform

Determine which OS is running and use the appropriate commands:

```bash
# Detect platform
uname -s | tr '[:upper:]' '[:lower:]'
```

- `linux` → Linux commands below
- `darwin` → macOS commands below
- `mingw*` / `msys*` / `cygwin*` → Windows (PowerShell via `pwsh` or `powershell`)

### 2 — Gather Information (Linux)

```bash
# OS & Kernel
cat /etc/os-release | grep -E 'PRETTY_NAME|VERSION_ID'
uname -rsm
hostname

# CPU
lscpu 2>/dev/null | grep -E 'Model name|Architecture|CPU\(s\)|Thread|Core|Socket' || true
grep -m1 'model name' /proc/cpuinfo | cut -d: -f2 | xargs || true
echo "Threads: $(nproc)"

# Memory & Swap
free -h 2>/dev/null | grep -E 'Mem|Swap' || cat /proc/meminfo | head -3

# All block devices and mounts (skip tmpfs, loop, squashfs)
df -h --output=source,fstype,size,used,avail,pcent,target 2>/dev/null | grep -v -E '^tmpfs|^loop|^squashfs|^efivarfs' || df -h | grep -v -E 'tmpfs|loop|squashfs'
lsblk -o NAME,SIZE,FSTYPE,MOUNTPOINT,MODEL 2>/dev/null | grep -v loop || true

# GPU / Accelerator — do NOT assume a discrete card exists!
# Check for integrated/SoC GPUs first (unified memory architectures)
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader 2>/dev/null || true
lspci 2>/dev/null | grep -iE 'vga|3d|display' || echo "No PCI GPU detected"

# For SoC/unified memory systems (e.g., NVIDIA GB10 DGX Spark, Apple Silicon):
# nvidia-smi may report [N/A] for VRAM because memory is unified.
# Check /proc/meminfo or lscpu for total system memory instead.
cat /sys/class/drm/card*/device/uevent 2>/dev/null | grep -i 'model\|device' || true

# System product info (for identifying SoC platforms)
cat /sys/class/dmi/id/product_name 2>/dev/null || dmidecode -s system-product-name 2>/dev/null || true
```

### 3 — Gather Information (macOS)

```bash
# OS & Hostname
sw_vers
hostname

# CPU
sysctl -n machdep.cpu.brand_string 2>/dev/null || true
sysctl -n hw.physicalcpu hw.logicalcpu 2>/dev/null || true
uname -m

# Memory
sysctl -n hw.memsize | awk '{printf "%.0f GB\n", $1/1073741824}'

# Disk (all volumes)
df -h | grep -v '^tmpfs\|^map\|^devfs' || df -h

# GPU
system_profiler SPDisplaysDataType 2>/dev/null | grep -E 'Chipset Model|VRAM|Displays:' || true
```

### 4 — Gather Information (Windows)

Run via `pwsh` or `powershell`:

```powershell
# OS & Hostname
$PSVersionTable.PSVersion
(Get-CimInstance Win32_OperatingSystem).Caption
hostname

# CPU
(Get-CimInstance Win32_Processor).Name
(Get-CimInstance Win32_Processor).NumberOfCores
(Get-CimInstance Win32_Processor).NumberOfLogicalProcessors

# Memory
$os = Get-CimInstance Win32_OperatingSystem
"{0:N1} GB" -f ($os.TotalVisibleMemorySize / 1MB)

# Disk (all volumes)
Get-Volume | Where-Object DriveLetter | Select-Object DriveLetter, FileSystemLabel, @{N='Size(GB)';E={[math]::Round($_.Size/1GB,1)}}, @{N='Free(GB)';E={[math]::Round($_.SizeRemaining/1GB,1)}} | Format-Table

# GPU
Get-CimInstance Win32_VideoController | Select-Object Name, AdapterRAM, DriverVersion | Format-Table
```

### 5 — Research Hardware (When Needed)

**Do NOT guess hardware specs.** If the commands return ambiguous or incomplete data:

1. Use `mcp_searxng_search_web` to look up the exact model/platform identified by system commands
2. Fetch authoritative sources (manufacturer docs, NVIDIA documentation, Apple spec sheets)
3. Cross-reference at least 2 sources before recording specs

Common pitfalls:
- **SoC / unified memory systems** (NVIDIA GB10 DGX Spark, Apple Silicon): The GPU is integrated into the SoC — there is NO discrete GPU and NO separate VRAM. `nvidia-smi` may report `[N/A]` for memory because all 128 GB of system RAM is shared between CPU and GPU.
- **ARM systems**: `/proc/cpuinfo` may show multiple "Model name" entries (big + little cores). Use `lscpu` or check the SoC model instead.
- **Virtual machines / containers**: Hardware info may reflect the host, not the guest. Note this distinction.

### 6 — Write the Card

Write `~/.pi/sys-scan.md` using this format:

```markdown
# System Scan — <hostname>

*Generated: <ISO-8601 timestamp>*

## OS
| Field | Value |
|-------|-------|
| Platform | Linux / macOS / Windows |
| Distribution | <PRETTY_NAME or equivalent> |
| Kernel / Version | <kernel version arch or OS build> |
| Hostname | <hostname> |

## CPU
| Field | Value |
|-------|-------|
| Model | <cpu model or SoC name> |
| Architecture | <arch: x86_64, aarch64, arm64> |
| Physical Cores | <cores> |
| Threads | <threads> |

## Memory
| Field | Value |
|-------|-------|
| Total RAM | <total> |
| Swap / Pagefile | <swap info or "none"> |

## GPU / Accelerator
<GPU details. If SoC with unified memory, note that explicitly:
"NVIDIA GB10 integrated (SoC) — no discrete GPU, shares 128 GB unified memory">

## Storage
| Device | Size | Used | Available | Mount |
|--------|------|------|-----------|-------|
| <dev> | <size> | <used> (<pct>) | <avail> | <mountpoint> |
| ... | ... | ... | ... | ... |
| **Total** | **<sum of all block device sizes>** | — | — | — |

```

### 7 — Ensure APPEND_SYSTEM.md References It

Check `~/.pi/agent/APPEND_SYSTEM.md`. If it does **not** contain a reference to
`sys-scan.md`, append this block:

```markdown
## System Information

When the user asks about the system, hardware, OS, or environment this agent is
running on, read `~/.pi/sys-scan.md` for a concise overview. If the information
seems stale (older than 7 days) or the user needs details not covered there, run
fresh commands to update it.
```

### 8 — Report Back

Summarize the key specs in your response so the user sees them immediately:

> **System:** <hostname> — <OS>, <CPU cores/threads>, <RAM>, <total disk>, <GPU/Accelerator>

## Rules

- **Always write to `~/.pi/sys-scan.md`** (not a project-local path) so it's
  shared across all sessions.
- **Include the timestamp** so staleness can be assessed later.
- **Keep it concise.** Use tables, not paragraphs. One card per system.
- **Handle missing tools gracefully.** If `lspci`, `nvidia-smi`, `free`, or any
  command is unavailable on this platform, note that rather than failing.
- **Overwrite the file** on each scan — don't append multiple cards.
- **Never guess hardware specs.** Research them via web search when system commands are ambiguous.
- **Distinguish SoC from discrete GPU.** Integrated GPUs share unified memory — do not report "VRAM" for systems that don't have separate video memory.
- **List ALL block device mounts** (not just root), with individual sizes and a total capacity row. Skip tmpfs, loop devices, and squashfs snapshots.
