# CC-WAG: Claude Code WhatsApp Gateway

## Architecture

CC-WAG connects WhatsApp to Claude via the Claude Agent SDK. Messages flow:
WhatsApp (Baileys) -> Gateway -> Agent Runner -> Claude Agent -> Claude SDK -> response -> WhatsApp

## Directory Structure

```
src/
  gateway.js          - Main entry point, HTTP server, adapter orchestration
  cli.js              - CLI for start/chat commands
  config.js           - Environment config, allowlists, agent settings
  adapters/
    base.js           - Base adapter interface
    whatsapp.js       - Baileys WhatsApp adapter with self-chat detection
  agent/
    claude-agent.js   - Claude agent with system prompt, memory, MCP tools
    runner.js         - Queue-based agent run coordinator
  providers/
    base-provider.js  - Provider interface
    claude-provider.js - Claude Agent SDK provider
  sessions/
    manager.js        - Session + JSONL transcript manager
  memory/
    manager.js        - Memory system (MEMORY.md + daily logs)
  tools/
    cron.js           - Cron/reminder scheduling MCP server
    gateway-mcp.js    - Gateway messaging MCP tools
  commands/
    handler.js        - Slash command handler (/new, /model, /todo, etc)
config/
  system-prompt.md    - System prompt template
  launchd/            - macOS launchd plist for daemon mode
workspace/            - Agent workspace (memory, cron jobs)
auth_whatsapp/        - Baileys auth state (gitignored)
transcripts/          - JSONL conversation transcripts (gitignored)
logs/                 - Log files (gitignored)
```

## Key Design Decisions

- WhatsApp only (no telegram/signal/imessage adapters)
- No Composio - stripped entirely
- Self-chat mode: Frank messages himself with "CC," prefix to trigger the agent
- Google Tasks via `gws` CLI (not Notion, not MCP)
- Claude provider only (no opencode provider)
- ESM modules throughout (.js extensions in imports)
- Absolute paths for file operations
- Node >= 22 required

## Self-Chat Flow

1. Frank sends "CC, what's on my schedule today" to himself on WhatsApp
2. Baileys receives fromMe message
3. WhatsApp adapter checks for "CC," prefix (case-insensitive)
4. Strips prefix, processes "what's on my schedule today"
5. Without prefix, fromMe messages are ignored (normal WhatsApp usage)

## Important Paths

- Workspace: /Users/ghost/Projects/cc-wag/workspace/
- Auth: /Users/ghost/Projects/cc-wag/auth_whatsapp/
- Transcripts: /Users/ghost/Projects/cc-wag/transcripts/
- Cron jobs: /Users/ghost/Projects/cc-wag/workspace/cron-jobs.json
- CLAUDE.md (global): ~/.claude/CLAUDE.md

## Google Tasks List IDs

- FloodDoctor: WUlnZzdORlJwa01PTEFVSw
- Personal: NE1SZ0pXUF9hT2pVczFUQg

## HTTP Endpoints

- GET /health - Health check JSON
- GET /qr - WhatsApp QR code page
- POST /api/send - Outbound message (Bearer token auth)

## Reference

Adapted from secure-openclaw at ~/Projects/cc-wag-reference/
