# pi-tools

Consolidated pi tools package: extensions, skills, and prompts for the pi coding agent.

## Contents

### Extensions

| Extension | Description |
|-----------|-------------|
| `chat/` | Zero-config WebSocket A2A chat between multiple pi agents. Uses mDNS for automatic peer discovery. |
| `sudoer/` | Lets the agent run `sudo` commands by prompting the user for their password via a masked input dialog. |
| `large-write/` | Write large files incrementally in chunks to avoid tool call generation timeouts. Accumulates content across multiple small tool calls and writes to disk on finalize. |

### Skills

| Skill | Description |
|-------|-------------|
| `chat/` | Agent-to-agent (A2A) chat over WebSockets with auto-discovery. |
| `large-write/` | Use `large_write` for files over 5KB to avoid timeouts by splitting content into small chunks. |

### Prompts

| Prompt | Description |
|--------|-------------|
| `peer-coordination.md` | Prompt template for coordinating work with peer agents. |

## Installation

```bash
pi install git:git@github.com:aposner2/pi-tools
```

## Dependencies

- `bonjour-service` — mDNS service discovery for peer chat
- `ws` — WebSocket server/client for chat communication

## Peer Dependencies

These are bundled by pi itself and should not be installed locally:

- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-tui`
- `typebox`

## License

MIT
