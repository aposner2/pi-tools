---
name: pi-chat
description: >
  Agent-to-agent (A2A) chat over WebSockets with auto-discovery. Communicate
  with other pi agents on the network — delegate tasks, share findings,
  coordinate work. Tools: chat_send, chat_peers, chat_history.
  Supports both inbound (listen) and outbound (connect) communication.
---

# Pi Chat — A2A Communication

## Tools

- **chat_send** — send a message to all connected peers
- **chat_peers** — list connected peer agents
- **chat_history** — view recent message history

## Usage

```
chat_peers()
chat_send({ message: "Tests pass on my end" })
chat_history({ limit: 10 })
```

## Tips

- Keep messages under 4000 chars to avoid timeouts
- Check peers before sending
- Incoming messages arrive as `[chat from <id>]` follow-up prompts
