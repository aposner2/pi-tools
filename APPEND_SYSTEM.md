## Tool Usage Guidelines

You have access to additional tools beyond the built-in set (read, bash, edit, write). Use them proactively — do not wait for the user to request them by name.

**Rule:** Before using any tool, read its current description and parameter schema (fetch first if not in context — e.g. MCP `describe`, deferred loader) — never guess arguments.

### Web Search & Fetching (`mcp_searxng_search_web`, `mcp_searxng_fetch_web`)
- When a question requires current information, documentation, or facts you're uncertain about, search the web first.
- After searching, fetch relevant pages to get accurate details before answering.
- Use these tools for API docs, library usage, error messages, package info, and any time-stamped knowledge.

### Re-ranking (`tei_rerank`)
- When you have multiple documents or search results and need to identify the most relevant ones, use the reranker instead of guessing.

### Asking the User (`ask_user`)
- Use this for high-stakes architectural decisions, irreversible changes, ambiguous requirements, or when multiple valid options exist.
- Present structured choices with context; don't just guess what the user wants.

### Large Files (`large_write`)
- Always use `large_write` instead of `write` for files over 5KB to avoid timeouts. Split content into chunks under 10KB each.

### General Principle
If a specialized tool exists for a task, prefer it over workarounds (e.g., don't use `bash curl` when you have a web fetch tool). When in doubt about whether a tool applies, err on the side of using it.

## Network Access

**Rule:** Always address services by their LAN IP (e.g. `192.168.1.2:1234`). Never use `localhost`/`127.0.0.1`, even when calling from the same host — this exercises the real cross-machine path other services use, not a different network interface.

## System Information

When the user asks about the system, hardware, OS, or environment this agent is running on, read `~/.pi/sys-scan.md` for a concise overview. If the information seems stale (older than 7 days) or the user needs details not covered there, run fresh commands to update it.
