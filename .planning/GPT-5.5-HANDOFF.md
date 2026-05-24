# Project Atlas — Full Handoff to GPT-5.5

**Author:** Frank Darakhshan (project owner) — drafted with Claude Code on 2026-05-24
**Audience:** GPT-5.5 (OpenAI), invoked as the senior engineer taking ownership of this codebase
**Mission of this document:** Give you (GPT-5.5) every piece of context you need to perfect Atlas — finish the last 10%, fix what's broken, harden what's fragile, and hand it back ready for daily use.

> If you read nothing else, read **§1 What this is**, **§4 Current state — what works / what's broken**, and **§11 Your deliverables**. Everything else is reference.

---

## 1. What this is

**Atlas** (internal repo name `cc-wag` = "Claude Code WhatsApp AI Gateway") is a 24/7 personal AI executive assistant for **Frank Darakhshan**, President of Flood Doctor LLC — a water-damage restoration company in Northern Virginia / DC / Maryland.

Atlas is a Node.js daemon running on Frank's Mac mini (M4). It bridges **WhatsApp** to **Anthropic's Claude Agent SDK**, so Frank can text his own WhatsApp number with the prefix `Atlas,` and get an agentic AI that can:

- Read/send email (Gmail via `gws` CLI, two business inboxes)
- Manage Google Calendar, Drive, Tasks
- Run shell commands on the Mac mini
- Query CompanyCam, Twilio, and other APIs
- Persist memory across conversations (JSONL observation log)
- Run scheduled cron jobs (briefings, follow-ups, alerts)
- Spawn other Claude Code sub-agents to do work in parallel

### Why it exists

Frank is **100% admin** — he never goes to job sites. His crews do the field work. Frank's day is:
- Writing Xactimate invoices from crew field data (~90% of his time)
- Chasing insurance adjusters for payment
- Pushing back when adjusters underpay
- Tracking 60+ active jobs and making sure nothing slips
- Managing SEO, marketing, website, online presence
- Making sure the business captures every lead 24/7

He works late (until ~5am) and sleeps late (~10–11am). Atlas runs on **his** schedule. The vision: Atlas is the **operations hub**. It answers team questions while Frank sleeps, tracks every job, nags about deadlines, helps write invoices, and turns Frank's 18-hour days into 10-hour days.

### Why you're being handed this

The codebase is feature-complete (44 plugin features, 39/39 tests green, daemon stable). The only thing keeping Atlas off WhatsApp production right now is a **Meta WhatsApp Business Sender registration** that requires a Facebook login — Claude couldn't do it because the OAuth flow can't be delegated. ChatGPT-5.5 launched today (2026-05-24); Frank wants you to go through the whole project end-to-end, perfect it, and unblock the final mile so he can use Atlas as a real production assistant again.

---

## 2. Repository & environment

| Item | Value |
|---|---|
| Git remote | `https://github.com/FrankDark007/cc-wag.git` |
| Branch | `main` (single-branch policy — never make side branches) |
| Project root (Frank's Mac) | `/Users/ghost/Projects/cc-wag/` |
| Node version | `>= 22` (specified in `package.json` engines) |
| Package manager | `npm` |
| Module system | ESM throughout (`"type": "module"`, `.js` extensions in imports) |
| Daemon | `launchd` — `~/Library/LaunchAgents/com.flooddoctor.cc-wag.plist` |
| Public tunnel | Cloudflare Tunnel — `atlas.vaserv.pro` → `localhost:4096` |
| Tests | `vitest` (`npm test`) — 39 tests, all passing |
| License | Private (`"private": true` in package.json) |

### Last 15 commits (chronological tail)

```
0cbb21d docs: add Meta WhatsApp Sender submission playbook + preflight checker
4e48439 feat: add contract-detector — e-sign contract → Drive folder + WhatsApp
7906d8d feat: add lead-watcher — Signpost calls + service requests → WhatsApp alerts
072ae6b feat: add atlas task dispatch scripts — Google Tasks → Claude Code queue
2f7e972 chore: stop tracking runtime logs — prevent daemon writes polluting git
abb2813 fix: capture plain SMS on Twilio webhook for verification codes
bdb47a7 feat: GSD task orchestration layer — planner, verifier, persistent tasks, handoff, context budget
5483cfe fix: stop token bleeding — model router defaults Sonnet, CC spawner uses Max, tiered prompts
9728249 fix: stable tunnel, cron token guard, Twilio health endpoint
8d94672 feat: add smart-organizer feature — Gmail filters + Drive folder automation
a4adc66 feat: add Twilio WhatsApp adapter as Baileys replacement
c6e4e3c fix: task-generator only intercepts pure number replies, not messages containing digits
cf3d5b6 fix: auto-clean stale WhatsApp sessions every 6 hours to prevent send timeouts
da71a74 fix: replace flock with shlock (macOS native) in gws-work.sh
5b3c235 update debug logs for audit — 2026-03-16 session (Phases 7-10 + bug fixes)
```

---

## 3. Architecture

### 3.1 High-level message flow

```
WhatsApp (Baileys or Twilio adapter)
       ↓
  Gateway.js (HTTP server :4096, plugin loader)
       ↓
  Adapter.handleMessage()  — checks allowlist + "Atlas," prefix
       ↓
  SessionManager  — JSONL transcript per chat
       ↓
  AgentRunner    — queue, dedup, concurrency, event emitter
       ↓
  ClaudeAgent    — system prompt + memory + observation context
       ↓
  Claude Agent SDK (@anthropic-ai/claude-agent-sdk)
       ↓
  Tool use loop: Bash / Read / Write / Edit / Glob / Grep / TodoWrite / Skill
       ↓
  Response → Adapter.sendMessage() → WhatsApp → Frank's phone
```

### 3.2 Directory layout

```
src/
  gateway.js            — Main entry, HTTP server, plugin auto-loader (712 LOC)
  cli.js                — CLI for start/chat commands
  config.js             — Environment config, allowlists, agent settings
  adapters/
    base.js             — Base adapter interface
    whatsapp.js         — Baileys WhatsApp adapter (legacy; sandbox use)
    twilio-whatsapp.js  — Twilio WhatsApp adapter (production target)
  agent/
    claude-agent.js     — System prompt + memory + observation context wiring
    runner.js           — Queue-based agent run coordinator (events: queued/processing/completed/failed)
  providers/
    base-provider.js
    claude-provider.js  — Claude Agent SDK provider
  sessions/
    manager.js          — JSONL transcript per chat
  memory/
    manager.js          — MEMORY.md + daily logs + observations JSONL
  tools/
    cron.js             — Cron/reminder scheduling MCP server (394 LOC)
    gateway-mcp.js      — Gateway messaging MCP tools
  commands/
    handler.js          — Slash commands: /new /model /todo /todos /inbox /briefing /summary /eod /job /scope /timeline etc.
  features/             — Plugin directory, auto-loaded at startup (44 files, 23k LOC total)
  utils/
    async-context.js
    job-data.js         — Job parsing/normalization helpers
config/
  system-prompt.md      — Atlas personality, commitment detection, team inbox rules
  email-templates/      — Branded HTML email templates (flood-doctor, restoration-doctor)
  launchd/              — macOS launchd plist
workspace/              — Runtime state (gitignored where it contains PII)
  jobs.json             — 60+ active jobs with status/amounts/deadlines
  disputes.json
  memory/
    observations.jsonl  — Structured observation memory
    team-inbox.jsonl    — Team message log
  cron-jobs.json
  sms-inbox.log         — Twilio SMS capture (for Meta OTPs)
auth_whatsapp/          — Baileys auth state (gitignored)
transcripts/            — JSONL conversation transcripts (gitignored)
logs/                   — Log files (gitignored)
scripts/                — Operational shell scripts
  atlas.sh              — Daemon control helper
  preflight-meta-submission.sh
  cc-dispatcher.sh, dispatch-task.sh, atlas-task-checker.sh
  gws-as.sh, gws-work.sh — Multi-account Google Workspace wrappers
  lead-watcher/         — Signpost calls + service requests → WhatsApp alerts
  contract-detector/    — E-sign contracts → Drive + WhatsApp
  import-drive-jobs.js
  launchd-start.sh
test/                   — vitest tests
  cron-parser.test.js
  job-data.test.js
  model-router.test.js
.planning/
  ATLAS-MASTER-ROADMAP.md
  META-WHATSAPP-SUBMISSION.md
  perplexity-strategy.md
  GPT-5.5-HANDOFF.md    ← this file
```

### 3.3 Plugin architecture (critical design contract)

Every feature in `src/features/*.js` exports a single function:

```javascript
export function register(gateway) {
  // Set up cron jobs, add commands, register hooks, etc.
  // Called exactly once at startup
}
```

**Invariants — DO NOT VIOLATE:**

1. **1 feature = 1 file = 1 commit.** Zero coupling between features.
2. **Delete any feature file → Atlas still works.** If you find inter-feature imports, that's a bug.
3. **No multi-file changes per feature.** A bug in feature A must not be able to break feature B.
4. **Simplest version first.** No frameworks. No abstractions before they're needed.
5. **Absolute paths everywhere** (`/Users/ghost/Projects/cc-wag/...`) — prevents path traversal issues.
6. **Use `gws` CLI for Google ops.** Two wrappers exist: `gws` (personal — `darakhshan.farough@gmail.com`) and `scripts/gws-work.sh` (business — `frankd@flooddoctorva.com`). Already authenticated; do not re-do OAuth.

### 3.4 Self-chat trigger flow

1. Frank sends `Atlas, what's on my schedule today?` to himself on WhatsApp
2. Baileys/Twilio receives `fromMe` message
3. Adapter checks for `Atlas,` prefix (case-insensitive; legacy `CC,` still works)
4. If prefix present: strip it, route to AgentRunner
5. If no prefix: ignore (normal WhatsApp use)

### 3.5 HTTP endpoints (gateway, port 4096)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | none | JSON health (status, adapter, uptime, queue depth) |
| GET | `/qr` | none | WhatsApp QR pairing page (Baileys only) |
| POST | `/api/send` | Bearer `GATEWAY_API_TOKEN` | Outbound message API |
| POST | `/webhook/twilio` | signature TBD | Inbound WhatsApp/SMS from Twilio |
| POST | `/webhook/companycam` | shared secret | CompanyCam photo upload events |

---

## 4. Current state — what works / what's broken

### ✅ Working

- **Daemon up:** `com.flooddoctor.cc-wag` launchd job loaded, gateway healthy on `localhost:4096`, tunnel reachable at `https://atlas.vaserv.pro/health`
- **All 39 vitest tests pass:** `cron-parser`, `job-data`, `model-router`
- **All 44 plugin features load at startup** without error
- **60+ jobs imported** into `workspace/jobs.json` from Google Drive scopesheets
- **Google Workspace integration solid:** both `gws` accounts (personal + work) authenticated, multi-brand email sending works
- **Smart model routing:** model-router defaults Sonnet, escalates to Opus for analysis, drops to Haiku for trivial
- **Memory/observation system:** JSONL writer + keyword search + auto-injection into agent context
- **Twilio adapter coded and wired** (`WHATSAPP_ADAPTER=twilio`, number `+15715821100` owned)
- **Twilio SMS webhook capturing inbound** to `workspace/sms-inbox.log` (will be used to receive Meta's OTP)
- **Bad-MAC crash loop fixed** (was a critical 2026-03-16 incident — see §6.1)
- **Tests for Twilio adapter and content templates:** in `test/` directory

### ❌ Blocked / broken / unfinished

1. **Meta WhatsApp Sender registration NOT submitted.** Twilio Senders array is empty. Without this, Atlas can only use Twilio's WhatsApp Sandbox (limited to opted-in numbers). Production requires Path A in `.planning/META-WHATSAPP-SUBMISSION.md` — needs a Facebook login that an AI agent can't perform. **This is the single biggest blocker.**

2. **Security debt — 4 unrotated credentials.** A prior session accidentally `cat`'d `.env` into context. The exposure is contained (only that session's context saw them) but Frank has not yet rotated:
   - `ANTHROPIC_API_KEY`
   - `TWILIO_AUTH_TOKEN` + `TWILIO_API_KEY_SECRET`
   - `COMPANYCAM_API_TOKEN`
   - `GATEWAY_API_TOKEN`

3. **Mission Control integration incomplete.** A sibling project (`~/flood-doctor/Mission-Control-APP/`) is "70% stubs" per the perplexity-strategy.md audit. Atlas was supposed to write into MC's claims tracker; the schema is not yet aligned.

4. **No Xactimate scope-draft generator yet.** Phase 6 of roadmap. `scope-assistant.js` (895 LOC) collects field data but doesn't yet emit Xactimate-formatted line items.

5. **CompanyCam webhook listener exists but is untested end-to-end.** `companycam-webhook.js` (319 LOC) is wired; no integration test confirms the photo→Drive→WhatsApp flow.

6. **Voice-to-scope not started.** Roadmap-listed enhancement: Whisper API transcription of crew voice notes → structured scope data.

7. **Stale WhatsApp sessions auto-cleanup** runs every 6 hours but the underlying Baileys `Bad MAC` race still exists at edge cases (key rotation during a long agent turn). Twilio adapter sidesteps this entirely, which is why production must move to Twilio.

8. **Some features have no tests.** Only 3 test files in `test/`. The 44 plugin features are largely untested in isolation.

9. **No CI.** The repo has no `.github/workflows/`. Tests run only when someone types `npm test` locally.

10. **Documentation drift.** `ATLAS-MASTER-ROADMAP.md` lists Phases 3–6 as "BUILD NEXT" but all of them are actually built. Roadmap doc is stale.

---

## 5. Tech stack

### Runtime / language

- **Node.js >= 22** (ESM throughout, `.js` extensions in imports, `"type": "module"`)
- **JavaScript** (not TypeScript — keep it simple)
- **macOS** (Mac mini M4, launchd for process supervision)

### Direct dependencies (from `package.json`)

```json
{
  "@anthropic-ai/claude-agent-sdk": "^0.1.0",  // Core agent loop
  "@whiskeysockets/baileys": "^6.7.16",        // WhatsApp Web client (legacy/sandbox)
  "cron-parser": "^5.5.0",                     // Schedule string parsing
  "dotenv": "^17.2.4",                         // .env loader
  "pino": "^9.6.0",                            // Structured logging
  "qrcode": "^1.5.4",                          // QR rendering for WhatsApp pairing
  "qrcode-terminal": "^0.12.0",                // Terminal QR
  "zod": "^3.24.0"                             // Schema validation
}
```

Dev dependency: `vitest ^4.1.0`.

### External services & APIs

| Service | What for | Auth |
|---|---|---|
| Anthropic Claude API | Agent loop, model routing | `ANTHROPIC_API_KEY` |
| Twilio Programmable Messaging | WhatsApp (prod target) + SMS for OTP capture | `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` |
| Meta / WhatsApp Business Platform | Business Sender registration | Facebook OAuth (out-of-band, human in loop) |
| Google Workspace (Gmail, Calendar, Drive, Tasks, Sheets) | Email, scheduling, document automation | `gws` CLI, dual-account (personal + work) |
| CompanyCam | Field photo platform | `COMPANYCAM_API_TOKEN` |
| Cloudflare Tunnel (`cloudflared`) | Public HTTPS for the local gateway | tunnel name `atlas-gateway`, hostname `atlas.vaserv.pro` |
| Tasker + Join (Android) | On-demand location sharing from Frank's phone | `JOIN_API_KEY` + `JOIN_DEVICE_ID` + `LOCATION_SECRET` |

### Environment variables (`.env.example`)

```
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-5-20250929
FRANK_PHONE=+17034981581
GATEWAY_PORT=4096
GATEWAY_API_TOKEN=change-me-to-a-random-string
LOG_LEVEL=info
WHATSAPP_ALLOWED_DMS=+17034981581,+12024598844
WHATSAPP_ALLOWED_GROUPS=
JOIN_API_KEY=your-join-api-key
JOIN_DEVICE_ID=your-pixel-device-id
LOCATION_SECRET=a-random-secret-for-tasker-to-include
```

Plus (not in example, but present in actual `.env`):
```
WHATSAPP_ADAPTER=twilio
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_API_KEY_SID=SK...
TWILIO_API_KEY_SECRET=...
COMPANYCAM_API_TOKEN=...
```

---

## 6. Notable history & gotchas

### 6.1 The Bad MAC crash loop (2026-03-16) — already fixed, do not regress

**Symptom:** Atlas went offline at night and wouldn't come back.

**Root cause:** WhatsApp's Signal Protocol encryption: when the Mac slept or WhatsApp rotated keys, `libsignal` threw `Bad MAC` errors as unhandled promise rejections. Node crashed. launchd restarted. Same crash. After ~10 rapid crashes, macOS throttled the service.

**Fix (committed as `05e625c`, `6e91977`, `f5b1ebd`):**
1. `gateway.js` — process-level `unhandledRejection`/`uncaughtException` handlers that catch Bad MAC and let Baileys recover
2. Auto-recovery: track Bad MAC errors per contact; after 5 in 1 minute, delete the corrupted `auth_whatsapp/session-*.json` files so Baileys re-negotiates
3. `launchd` plist: `ThrottleInterval: 5` to prevent macOS aggressive throttling

If you touch `gateway.js`, preserve these handlers.

### 6.2 Intake-bot intercepting Frank's own messages

Intake-bot used to assume any "unknown contact" was a new customer lead. Frank's self-chat arrives as WhatsApp's new `@lid` (Linked ID) format, not the phone JID. Result: Atlas thought Frank was a customer and started asking for his name. Fix is in place; if you modify intake-bot, preserve the LID detection and self-chat skip.

### 6.3 Twilio adapter is the production path

Baileys (WhatsApp Web reverse-engineered) is fragile and unofficial. The Twilio adapter (`a4adc66`) is the production target. The two adapters are switchable via `WHATSAPP_ADAPTER=twilio|baileys`. **All new work assumes Twilio.**

### 6.4 Broken scripts that were silently failing for weeks

Before commits `7906d8d`, `4e48439`, `072ae6b`, several scripts in `scripts/` had been broken for weeks:
- Wrong port (`3007` instead of `4096`)
- Wrong field name (`chatId` instead of `chat_id`)
- Missing `Authorization: Bearer` header
- Result: every notification attempt returned 401

All known cases are fixed. If you add scripts that talk to the gateway, the canonical pattern is:

```bash
curl -s -X POST http://localhost:4096/api/send \
  -H "Authorization: Bearer $GATEWAY_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"chat_id\":\"$FRANK_JID\",\"text\":\"$MESSAGE\"}"
```

### 6.5 Multi-brand email sender routing

Frank operates two brands: `Flood Doctor` (frank@flood.doctor) and `Restoration Doctor` (frank@restorationdoctor.com). `gws +send` does NOT support `--from`; to send as an alias you must build a raw MIME message and base64-encode it. The pattern is documented in `config/system-prompt.md`.

### 6.6 .env handling is a SECURITY HARD RULE

**Never run bash commands that would output credential values.** When searching `.env`:
- `grep -c PATTERN .env` — count only (safe)
- `grep -l PATTERN .env` — filename only (safe)
- **Never** `cat .env`, `grep -h .env`, or read `.env` with the Read tool — these dump secrets into the model's context

This rule was violated in a prior session, which is why the §4 security debt exists. Do not repeat.

---

## 7. Full feature inventory (`src/features/`)

44 plugin files, ~23k LOC. Each is self-contained.

| File | LOC | Purpose |
|---|---:|---|
| `adjuster-followup.js` | — | Cron: nag adjusters who haven't responded in N days |
| `adjuster-tracker.js` | — | Track open claims per job (adjuster, dispute status, docs sent) |
| `calendar-alerts.js` | — | 30-min pre-event WhatsApp alerts from Google Calendar |
| `cc-spawner.js` | — | Spawn child Claude Code instances to delegate work |
| `companycam-webhook.js` | 319 | Real-time inbound webhook from CompanyCam photo uploads |
| `companycam.js` | 458 | CompanyCam API client + `/timeline FD-NNN` builder |
| `context-budget.js` | 212 | Track agent context usage, alert on bleeding |
| `daily-summary.js` | 251 | 6 PM end-of-day recap + `/summary` command |
| `data-integrator.js` | 488 | Merge data across CompanyCam, Encircle, Drive |
| `deadline-enforcer.js` | 376 | Cron: jobs with overdue invoice dates, lien deadlines |
| `debug-logger.js` | 222 | Structured debug log for audit sessions |
| `doc-packager.js` | 478 | `/job FD-NNN package` → assemble photos+scope+moisture for adjuster |
| `email-actions.js` | 442 | Extract action items from inbox: "Adjuster needs moisture logs for FD-012 by Fri" |
| `email-filer.js` | 378 | When supervisor emails docs, auto-file in correct Drive folder |
| `email-watcher.js` | 214 | VIP email triage alerts every 15 min |
| `equipment-tracker.js` | 534 | Track air movers, dehus, scrubbers across active jobs |
| `error-reporter.js` | 233 | Surface daemon errors to Frank via WhatsApp |
| `health-monitor.js` | 510 | Self-check: gateway, tunnel, gws auth, Twilio, CompanyCam — every 5 min |
| `inbox-miner.js` | 606 | Extract structured leads/jobs/disputes from unread Gmail |
| `intake-bot.js` | 466 | New-customer intake flow on unknown WhatsApp contacts (skips Frank's self-chat / LID) |
| `job-auditor.js` | 599 | Audit completed jobs for invoiceable items |
| `job-tracker.js` | 530 | Core jobs.json CRUD + `/job` slash commands |
| `learning-loop.js` | 266 | Log Frank's corrections; refine prompts over time |
| `license-monitor.js` | 417 | Alert on DPOR/MHIC/insurance expiry: 30/14/7 days |
| `lien-tracker.js` | 429 | Track Virginia Code §43-4 lien filing deadlines (90 days from last work) |
| `model-router.js` | 132 | Route by complexity: Haiku/Sonnet/Opus |
| `monday-importer.js` | 655 | Pull from Monday.com (legacy import path) |
| `morning-briefing.js` | 327 | 10:30 AM briefing on Frank's schedule + `/briefing` |
| `payment-nudge.js` | 286 | `/job FD-NNN nudge` → branded payment reminder email |
| `payment-receipt.js` | 271 | `/job FD-NNN paid 8500` → record payment + send branded receipt |
| `persistent-tasks.js` | 325 | Long-running tasks survive daemon restarts |
| `plugin-updater.js` | 396 | Self-update mechanism for plugins |
| `pushback-assistant.js` | 781 | Draft adjuster pushback letters citing IICRC S500/S520 + Xactimate pricing |
| `revenue-dashboard.js` | 379 | `/revenue` → invoiced, collected, outstanding, aging report |
| `scope-assistant.js` | 895 | `/scope` WhatsApp data collection wizard for crews |
| `self-restart.js` | 229 | Atlas can restart itself on schedule or error |
| `session-handoff.js` | 170 | Save context for the next Claude Code session |
| `smart-organizer.js` | 695 | Gmail filters + Drive folder automation |
| `task-generator.js` | 430 | Turn WhatsApp messages into Google Tasks |
| `task-planner.js` | 391 | Multi-step task decomposition |
| `task-verifier.js` | 118 | Verify completed tasks meet acceptance criteria |
| `token-monitor.js` | 240 | Track Claude API token spend per session |
| `work-delegator.js` | 144 | Route work to the right child agent |
| `workflows.js` | 799 | Multi-step workflow engine |

### Roadmap phase mapping

- **Phase 1 (Foundation):** model-router, morning-briefing, calendar-alerts, email-watcher, daily-summary, memory manager, observation logging — ✅ all shipped
- **Phase 2 (Job & Invoice Ops):** job-tracker, deadline-enforcer, scope-assistant, jobs.json import, launchd daemon — ✅ all shipped
- **Phase 3 (Email & Doc Automation):** email-filer, payment-nudge, payment-receipt, email-actions — ✅ all shipped (roadmap doc is stale)
- **Phase 4 (CompanyCam):** companycam.js + companycam-webhook.js — ✅ shipped, but end-to-end test missing
- **Phase 5 (Adjuster Management):** adjuster-tracker, adjuster-followup, doc-packager, pushback-assistant — ✅ all shipped
- **Phase 6 (Business Intelligence):** revenue-dashboard, lien-tracker, license-monitor, intake-bot — ✅ all shipped

---

## 8. The Meta WhatsApp Sender block (THE thing to unblock)

Full playbook lives at `/Users/ghost/Projects/cc-wag/.planning/META-WHATSAPP-SUBMISSION.md`. Summary:

### State

- Twilio number `+15715821100` purchased, friendly name "Atlas - Flood Doctor" ✅
- SMS webhook already points at `https://atlas.vaserv.pro/webhook/twilio` ✅ (this is how Meta's OTP gets captured into `workspace/sms-inbox.log`)
- Twilio WhatsApp Senders array: **empty** ❌
- Twilio adapter wired in code, `WHATSAPP_ADAPTER=twilio` set ✅
- Preflight script: `bash scripts/preflight-meta-submission.sh` exits 0 ✅

### What needs to happen (Path A — Twilio Embedded Signup)

1. Frank logs into Twilio Console → Messaging → Senders → WhatsApp senders → Create new Sender
2. Choose "Register a number with WhatsApp", select `+15715821100`
3. Click "Continue with Facebook" — Meta popup opens
4. In the popup: log into Facebook (account that admins the Flood Doctor FB Page), select/create Meta Business Account "Flood Doctor LLC", create WABA "Flood Doctor LLC"
5. Display name: `Flood Doctor` (primary) or `Flood Doctor LLC` (fallback)
6. Category: Professional Services or Cleaning Services
7. Business website: `https://flood.doctor`
8. Business address: `8466D Tyco Rd, Vienna, VA 22182`
9. Verification phone: `+15715821100` — OTP delivery via SMS
10. Tail `workspace/sms-inbox.log` to read Meta's OTP when it arrives, type it into Meta popup
11. If Meta asks for business verification: upload Virginia SCC Certificate of Organization (1–3 business day review)
12. Once Twilio shows status `ONLINE`: set inbound messages webhook to `https://atlas.vaserv.pro/webhook/twilio`
13. End-to-end test: send `Atlas, are you online?` from personal WhatsApp to `+15715821100`

### After Sender is ONLINE — message template submission

Atlas's proactive outbound (briefings, lead alerts, follow-up nags) requires pre-approved templates. Three templates to submit:

1. `atlas_daily_briefing` — UTILITY, en_US
2. `atlas_new_lead_alert` — UTILITY, en_US
3. `atlas_adjuster_followup_reminder` — UTILITY, en_US

Full bodies in `META-WHATSAPP-SUBMISSION.md` § Message Template submission. Always UTILITY, never MARKETING — Meta reviews UTILITY in hours, MARKETING in days with stricter rules.

### What you (GPT-5.5) can and can't do here

**You CAN:**
- Walk Frank through Path A step by step
- Watch `workspace/sms-inbox.log` for the OTP and read it back
- Verify gateway + tunnel health at submission time
- Submit message templates via Twilio API once Frank hands you a WABA ID
- Wire a Sender-status poll: every 60s check Twilio, WhatsApp Frank on state change
- Diagnose Meta rejections (rejection-cause matrix in §META-WHATSAPP-SUBMISSION.md)

**You CANNOT:**
- Log into Frank's Facebook (2FA, not delegatable)
- Upload his LLC docs to Meta Business Suite
- Sit in Meta's human review queue

---

## 9. Operational runbook (for you, GPT-5.5)

### 9.1 Daemon control

```bash
# Check status
launchctl list | grep flooddoctor

# Start / restart
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.flooddoctor.cc-wag.plist 2>/dev/null
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.flooddoctor.cc-wag.plist

# Or via helper
bash /Users/ghost/Projects/cc-wag/scripts/atlas.sh restart

# Health
curl -s http://localhost:4096/health | python3 -m json.tool
curl -s https://atlas.vaserv.pro/health | python3 -m json.tool

# Tail logs
tail -f /Users/ghost/Projects/cc-wag/logs/gateway.log
```

### 9.2 Tests

```bash
cd /Users/ghost/Projects/cc-wag && npm test
# Expected: 39 passed, 0 failed
```

### 9.3 Sending a manual message via API

```bash
SID=$(grep -E '^TWILIO_ACCOUNT_SID=' /Users/ghost/Projects/cc-wag/.env | cut -d= -f2)
# DO NOT also dump the auth token; use it indirectly:
TOKEN=$(grep -E '^GATEWAY_API_TOKEN=' /Users/ghost/Projects/cc-wag/.env | cut -d= -f2)
curl -s -X POST http://localhost:4096/api/send \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"chat_id":"17034981581@s.whatsapp.net","text":"Hello from GPT-5.5"}'
```

### 9.4 Preflight before any Meta submission attempt

```bash
bash /Users/ghost/Projects/cc-wag/scripts/preflight-meta-submission.sh
# Must exit 0 with all checks green except the expected "no senders yet"
```

### 9.5 Watching for Meta's OTP

```bash
tail -f /Users/ghost/Projects/cc-wag/workspace/sms-inbox.log
```

---

## 10. Rules of engagement (you MUST follow these)

These come from Frank's global config and project CARL rules. Non-negotiable.

1. **Always commit to `main`.** Verify with `git branch --show-current` before every commit. Never create side branches unless Frank asks.
2. **One logical change = one immediate commit.** Never batch. Never leave uncommitted work.
3. **Commit message style:** imperative, concise, focused on the "why" not the "what" (e.g., `fix: stop token bleeding — model router defaults Sonnet`).
4. **Never use destructive git** (`--force`, `--hard`, `reset --hard`) without explicit permission.
5. **Never commit secrets.** `.env`, credentials, tokens, API keys — gitignored already, keep it that way.
6. **Absolute paths in code** (`/Users/ghost/Projects/cc-wag/...`).
7. **Relative paths in messages to Frank** (so they're clickable in his terminal).
8. **Read before editing.** Never edit a file you haven't read.
9. **Plugin invariant:** 1 feature = 1 file. Do not create cross-feature imports.
10. **Use the right `gws` wrapper:** `gws` for personal, `scripts/gws-work.sh` for business. Default is business for all Flood Doctor work.
11. **Prefer editing existing files over creating new ones** unless explicitly required.
12. **Never claim "done" without verification.** Build passes, imports resolve, no runtime crashes, tests green. Provide proof.
13. **Security hard rule:** never run a command that outputs a credential value. `grep -c` or `grep -l` only; never `cat .env`.

---

## 11. Your deliverables (what "perfecting Atlas" means)

In priority order. Treat each as a milestone. Commit each as you go.

### P0 — Unblock production (this week)

1. **Walk Frank through Meta Embedded Signup** (§8) until the Twilio Sender shows `ONLINE`. You drive the screens, he clicks. Tail `sms-inbox.log` to read OTPs back to him.
2. **Submit the three message templates** via Twilio Content Template Builder.
3. **Wire Twilio inbound webhook** at `https://atlas.vaserv.pro/webhook/twilio` once the Sender is approved.
4. **End-to-end test:** send `Atlas, are you online?` from Frank's personal WhatsApp to `+15715821100`, confirm round-trip <15 s in `gateway.log`.

### P1 — Pay down security debt (immediately after P0)

5. **Rotate the four leaked credentials** (§4 item 2): ANTHROPIC, TWILIO_AUTH, COMPANYCAM, GATEWAY. Update `.env`. Restart daemon. Verify health.
6. **Move `.env` reads behind a helper** that masks values in any error trace or log line. Add a unit test that asserts no secret leaks into pino output.

### P2 — Test coverage & CI (week 2)

7. **Add a vitest test for every feature** that has a registered cron job or command — minimum: `register()` runs without throwing, command handler returns expected shape.
8. **Add a GitHub Actions workflow** (`.github/workflows/test.yml`) running `npm test` on every push to main. Status badge in a new README.
9. **Add an integration test for the Twilio adapter:** mocked Twilio API, asserts adapter sends correct payload shape and parses incoming webhook bodies.

### P3 — Finish the unfinished features

10. **CompanyCam end-to-end test:** simulate a photo-upload webhook, assert the Drive filing flow completes and Frank's WhatsApp gets the alert.
11. **Xactimate scope-draft generator:** add a `scope-draft-generator.js` feature that takes the structured data from `scope-assistant.js` and emits Xactimate-formatted line items (codes + quantities + units). Reference: ATLAS-MASTER-ROADMAP.md § Phase 7. Build a small JSON knowledge base of common WTR/MITIG/DEMO codes first.
12. **Voice-to-scope prototype:** add `voice-scope.js` feature that accepts WhatsApp voice notes, transcribes via Whisper API, parses to structured scope data using Claude, feeds the same pipeline as the text-based `/scope` command.

### P4 — Documentation & hardening

13. **Refresh `ATLAS-MASTER-ROADMAP.md`** — Phases 3–6 are shipped; reclassify and add Phase 7 (Xactimate generator) and Phase 8 (voice-to-scope).
14. **Write `ARCHITECTURE.md`** at repo root (currently only `.claude/CLAUDE.md` has architecture notes). Diagram the message flow. Document the plugin contract. Make it the canonical onboarding doc for the next AI taking over.
15. **Audit and fix any feature that has inter-feature imports.** The plugin invariant says zero coupling — measure it with `grep -r "from '\\./" src/features/` and fix any hits.
16. **Add a `health-monitor.js` external alert path:** if 3 consecutive health checks fail, send Frank an SMS via Twilio (not WhatsApp — WhatsApp may be the thing that's down).

### P5 — Things to consider (open questions, ask Frank before doing)

17. Should Atlas's memory move from JSONL to SQLite for query speed? (Currently 540 LOC of memory manager.)
18. Should `intake-bot.js` route to a dedicated business number instead of Frank's self-chat once WhatsApp Business is live?
19. Should we deprecate the Baileys adapter once Twilio is stable? (Frees ~12k LOC of dependency surface.)
20. Should `cc-spawner.js` be rewritten now that the Claude Agent SDK supports sub-agents natively?

---

## 12. How to communicate with Frank

- He uses ChatGPT in the browser (web app). Paste this whole document into a new conversation, then keep working there.
- He's most responsive late afternoon and late night (working hours ~3 PM–5 AM eastern).
- He prefers terse + complete: full files, not snippets. Bullet plans, not paragraphs. No preamble.
- He will copy your output into his terminal himself — give him **exact** commands, not "you could try" suggestions.
- When a multi-file change is needed, **plan first, then execute.** State the files, get a thumbs-up, then edit.
- He values: working software shipped fast, atomic commits, honest "this is broken because X" diagnoses, refusal to fake completion.
- He distrusts: vague reassurances, premature abstractions, framework worship, secret-leaking commands.

---

## 13. Quick start for you (GPT-5.5) right now

```bash
# 1. Clone
git clone https://github.com/FrankDark007/cc-wag.git
cd cc-wag

# 2. Read these in order
cat .planning/GPT-5.5-HANDOFF.md      # this file
cat .planning/META-WHATSAPP-SUBMISSION.md
cat .planning/ATLAS-MASTER-ROADMAP.md
cat .claude/CLAUDE.md
cat config/system-prompt.md
ls src/features/                       # 44 features to skim

# 3. Check live state (if you're running on Frank's machine)
bash scripts/preflight-meta-submission.sh
curl -s http://localhost:4096/health | python3 -m json.tool
npm test

# 4. Pick the top P0 item — walk Frank through Meta Embedded Signup
```

---

## 14. Final note from Claude (the AI handing this off)

Atlas is a personal project built carefully over months. The plugin invariant — 1 feature = 1 file = 1 commit, zero coupling — is the thing that has kept it shippable. Honor it. The temptation to "refactor into a clean framework" will be strong; resist it. Frank's time is the scarce resource, not LOC.

The Meta block is mundane but real: a Facebook OAuth that no AI can perform on his behalf. Get him through it kindly, in one sitting if possible. Once that's done, this project graduates from "Claude's side project" to "Frank's daily operations hub." That's the win condition.

Good luck.

— Claude Code, 2026-05-24
