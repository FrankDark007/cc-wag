# Atlas: WhatsApp AI Executive Assistant

## Architecture

Atlas connects WhatsApp to Claude via the Claude Agent SDK. Messages flow:
WhatsApp (Baileys) -> Gateway -> Agent Runner -> Claude Agent -> Claude SDK -> response -> WhatsApp

## Directory Structure

```
src/
  gateway.js          - Main entry, HTTP server, plugin loader
  cli.js              - CLI for start/chat commands
  config.js           - Environment config, allowlists, agent settings
  adapters/
    base.js           - Base adapter interface
    whatsapp.js       - Baileys WhatsApp adapter with self-chat detection
  agent/
    claude-agent.js   - Claude agent with system prompt, memory, observation context
    runner.js         - Queue-based agent run coordinator
  providers/
    base-provider.js  - Provider interface
    claude-provider.js - Claude Agent SDK provider
  sessions/
    manager.js        - Session + JSONL transcript manager
  memory/
    manager.js        - Memory (MEMORY.md + daily logs + observations JSONL)
  tools/
    cron.js           - Cron/reminder scheduling MCP server
    gateway-mcp.js    - Gateway messaging MCP tools
  commands/
    handler.js        - /new /model /todo /todos /inbox /briefing /summary /eod
  features/           - Plugin directory (auto-loaded at startup)
    model-router.js   - Smart Haiku/Sonnet/Opus routing by complexity
    morning-briefing.js - 7:30 AM briefing + /briefing command
    calendar-alerts.js  - 30-min pre-event WhatsApp alerts
    email-watcher.js    - VIP email triage alerts every 15 min
    daily-summary.js    - 6 PM end-of-day recap + /summary command
config/
  system-prompt.md    - Atlas personality, commitment detection, team inbox
  launchd/            - macOS launchd plist for daemon mode
workspace/            - Agent workspace (memory, cron jobs)
  memory/
    observations.jsonl  - Structured observation memory (JSONL)
    team-inbox.jsonl    - Team message log
auth_whatsapp/        - Baileys auth state (gitignored)
transcripts/          - JSONL conversation transcripts (gitignored)
logs/                 - Log files (gitignored)
```

## Plugin Architecture

Features auto-load from `src/features/*.js` at startup. Each exports `register(gateway)`.
Delete any feature file → Atlas works without it. Zero coupling.

## Key Design Decisions

- WhatsApp only (no telegram/signal/imessage adapters)
- Plugin architecture: each feature = 1 isolated file
- Smart model routing: Haiku for simple, Sonnet default, Opus for analysis
- Observation memory: JSONL-based, keyword search, auto-injected context
- Self-chat mode: Frank messages himself with "Atlas," prefix to trigger the agent
- Google Tasks via `gws` CLI (not Notion, not MCP)
- Claude provider only (no opencode provider)
- ESM modules throughout (.js extensions in imports)
- Absolute paths for file operations
- Node >= 22 required

## Self-Chat Flow

1. Frank sends "Atlas, what's on my schedule today" to himself on WhatsApp
2. Baileys receives fromMe message
3. WhatsApp adapter checks for "Atlas," prefix (case-insensitive, "CC," still works as legacy)
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
