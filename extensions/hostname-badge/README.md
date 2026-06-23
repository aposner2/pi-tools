# Hostname Badge

Shows a persistent hostname badge above the input editor so you always know which machine you're running on. Useful when managing multiple machines via PI WEB, SSH, or remote sessions.

## Features

- Displays `[hostname]` above the input editor
- Optionally shows the current model: `[hostname] · model-id`
- Toggle with `/hostname` command

## Configuration

Create `config.json` in one of these locations (checked in order):

1. Extension directory: `<extension>/config.json`
2. Global: `~/.pi/agent/extensions/hostname-badge/config.json`
3. Project-local: `<project>/.pi/extensions/hostname-badge/config.json`

```json
{
  "enabled": true,
  "showModel": true
}
```

### Options

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | `boolean` | `true` | Show the hostname badge |
| `showModel` | `boolean` | `true` | Include current model ID in the badge |

## Commands

| Command | Description |
|---------|-------------|
| `/hostname` | Toggle the hostname badge on/off |
