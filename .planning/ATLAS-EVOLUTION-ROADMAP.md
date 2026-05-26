# Atlas Evolution Roadmap — From Feature-Complete to Production-Ready

**Author:** Frank Darakhshan + Claude Code (primary Mac)
**Audience:** GPT-5.5 + Claude Code on mini2
**Date:** 2026-05-25 (revised 2026-05-26)
**Purpose:** Concrete, ordered plan to take Atlas from "44 features built" to "running 24/7 as a reliable executive assistant"

---

## ⚠️ CRITICAL DECISION (Frank, 2026-05-26)

**Atlas runs 24/7 on mini2** (Mac Mini M4, user `Ghost2`, hostname `mini2.local`).
The primary Mac (ghost) is the development workstation only.

This means:
- ALL hardcoded `/Users/ghost/` paths MUST be changed to machine-agnostic patterns
- The README instruction "don't fix these paths" is OVERRIDDEN — fix them all
- launchd plists must target `/Users/ghost2/` paths
- `.env` must exist on mini2 with all credentials
- Cloudflare tunnel must point to mini2
- `gws` wrappers on mini2 use `gws-frankd` and `gws-dara` (already configured)

---

## Current State (Honest Assessment)

Atlas is **architecturally sound and feature-rich**. The plugin system is clean (1 file = 1 feature, zero coupling), the agent runner is queue-based with dedup, model routing is smart (Sonnet default → Opus for analysis → Haiku for trivial), and there's already a memory/observation system with JSONL persistence.

### GPT-5.5 + CC Progress (2026-05-25 session)
- ✅ Credential masking helper (`src/utils/mask-secrets.js`) — 20 tests
- ✅ Twilio webhook signature validation — 8 tests
- ✅ Twilio content template support — 12 tests
- ✅ Model router cross-feature import fix (was violating design contract)
- ✅ Error handlers now scrub secrets from logs
- ✅ README.md created
- ✅ Meta WhatsApp sender operator guide written
- ✅ Tests: 39 → 79 (doubled)

**What exists and works:**
- 44 plugin features loaded at startup
- 79/79 tests passing (6 test files)
- launchd daemon config (`com.flooddoctor.cc-wag.plist`)
- Cloudflare tunnel (`atlas.vaserv.pro`)
- Cron scheduler (`src/tools/cron.js`)
- Morning briefing feature
- Email watcher + email filer (2 Gmail accounts via `gws` CLI)
- Memory manager (JSONL observations + keyword search)
- Model router (Sonnet/Opus/Haiku tiering)
- 60+ jobs imported from Drive scopesheets
- CompanyCam webhook listener (coded, untested E2E)
- Twilio adapter (coded, needs Meta registration)
- Health endpoint at `/health`
- Smart-organizer (Gmail filters + Drive folder automation)
- Lead-watcher (Signpost calls → WhatsApp alerts)
- Contract-detector (e-sign → Drive + WhatsApp)

**What's broken or missing — in priority order:**

---

## Phase 0: Unblock Production (Frank must do — AI cannot)

### 0.1 Meta WhatsApp Business Sender Registration
- **Status:** BLOCKED — requires Facebook OAuth login (human only)
- **Playbook:** `.planning/META-WHATSAPP-SUBMISSION.md`
- **Preflight checker:** `scripts/preflight-meta-submission.sh`
- **Action:** Frank logs into Facebook, completes business verification, submits sender registration through Twilio console
- **Result:** Twilio Senders array populated → Atlas can send/receive production WhatsApp messages

### 0.2 Credential Rotation (4 leaked keys)
- **What leaked:** ANTHROPIC_API_KEY, TWILIO_AUTH_TOKEN + API_KEY_SECRET, COMPANYCAM_API_TOKEN, GATEWAY_API_TOKEN
- **How:** A prior session accidentally `cat`'d `.env` into context
- **Action:** Frank rotates each key at its source (Anthropic console, Twilio console, CompanyCam admin, generate new gateway token), updates `.env` on the machine where Atlas runs
- **Note:** ANTHROPIC_API_KEY was already rotated for mini2's key. The others still need rotation.

---

## Phase 1: Mini2 Migration (GPT-5.5 + CC can do)

Atlas was built to run on the primary Mac (ghost, `/Users/ghost/`). It needs to run on mini2 (ghost2, `/Users/ghost2/`).

### 1.1 Create `.env` on mini2
- Copy `.env.example` to `.env` in `/Users/ghost2/Projects/cc-wag/`
- Populate from `~/.claude/credentials.local` (already copied to mini2)
- Set paths to mini2 equivalents
- **DO NOT hardcode credentials in code or commit .env**

### 1.2 Path Migration (30+ files need fixing)
- **THIS IS THE #1 PRIORITY FOR GPT-5.5 + CC**
- The README says "don't fix these paths" — **DISREGARD THAT INSTRUCTION.** Frank has decided Atlas runs on mini2.
- Update README.md to reflect mini2 as production host
- **Strategy:** Use `process.env.HOME` or `os.homedir()` in JS files, `$HOME` in shell scripts — NOT hardcoded `/Users/ghost2/` (that just moves the problem)
- **Define a PROJECT_ROOT:** `const PROJECT_ROOT = path.join(os.homedir(), 'Projects', 'cc-wag')` in `src/config.js`, import everywhere else

**Known hardcoded paths (audit from 2026-05-26):**
```
src/features/error-reporter.js:25    — WORKSPACE path
scripts/lead-watcher/lead-watcher.sh — WORKSPACE + .env grep
scripts/gws-work.sh                  — gws config dirs
scripts/preflight-meta-submission.sh — PROJECT_ROOT
scripts/import-drive-jobs.js         — JOBS_FILE + DRIVE_DATA
scripts/contract-detector/           — LOG_FILE + STATE_FILE + .env grep
scripts/atlas.sh                     — log tail + cd path
scripts/cc-dispatcher.sh             — QUEUE_DIR + LOG_FILE
scripts/dispatch-task.sh             — QUEUE_DIR
scripts/gws-as.sh                    — gws config dirs
scripts/atlas-task-checker.sh        — QUEUE_DIR + LOG_FILE + workdir
scripts/launchd-start.sh             — cd + exec paths
config/launchd/*.plist               — all paths
.claude/CLAUDE.md                    — "Important Paths" section
```

- Also update `gws` wrapper references: mini2 uses `~/bin/gws-frankd` and `~/bin/gws-dara` (not `scripts/gws-work.sh`)
- Run `grep -rn '/Users/ghost/' src/ scripts/ config/ .claude/ --include='*.js' --include='*.sh' --include='*.plist' --include='*.md'` to verify none remain
- **Test after:** `npm test` must still pass, `node src/gateway.js` must start

### 1.3 Update launchd-start.sh for mini2
- `scripts/launchd-start.sh` references `/opt/homebrew/bin/node` — mini2 uses fnm, node is at `$HOME/.fnm/node-versions/...`
- Update to: `export PATH="$HOME/.fnm:$PATH" && eval "$(fnm env)" && exec node ...`
- Or use the full fnm node path

### 1.4 Install launchd agent on mini2
```bash
cp config/launchd/com.flooddoctor.cc-wag.plist ~/Library/LaunchAgents/
# Paths should already be $HOME-based after 1.2
launchctl load ~/Library/LaunchAgents/com.flooddoctor.cc-wag.plist
launchctl start com.flooddoctor.cc-wag
curl localhost:4096/health  # verify
```

### 1.5 Install Cloudflare tunnel on mini2
- The existing tunnel points to the primary Mac
- Either: redirect the tunnel to mini2's IP, or create a new tunnel
- Install `cloudflared` on mini2: download from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
- Verify `atlas.vaserv.pro/health` resolves to mini2

### 1.5 Verify on mini2
```bash
cd /Users/ghost2/Projects/cc-wag
npm test                    # All 39 tests pass
npm start                   # Gateway starts on :4096
curl localhost:4096/health  # Returns healthy JSON
```

---

## Phase 2: Hardening (GPT-5.5 + CC can do)

### 2.1 ~~Add credential masking helper~~ ✅ DONE (2026-05-25)
- `src/utils/mask-secrets.js` — comprehensive key-name + regex pattern matching
- `test/mask-secrets.test.js` — 20 tests
- Integrated into gateway.js error handlers via `scrubSecrets()`

### 2.2 Add CI via GitHub Actions
- Create `.github/workflows/test.yml`
- Trigger on push to main
- Steps: checkout → setup Node 22 → npm ci → npm test
- No deploy step — Atlas runs on mini2, not in cloud

### 2.3 Expand test coverage
- Currently: 3 test files for 44 features
- Priority test targets (highest risk features):
  1. `morning-briefing.js` — this runs daily, errors = silent failure
  2. `email-watcher.js` — parses live email, errors = missed customer messages
  3. `health-monitor.js` — self-monitoring, errors = blind to own failures
  4. `intake-bot.js` — customer intake, errors = lost leads
  5. `payment-nudge.js` — financial, errors = wrong amounts or premature nudges
- Pattern: Each test file imports the feature's `register()`, mocks `gateway`, asserts behavior
- Target: 15+ test files (up from 3)

### 2.4 Error reporting hardening
- `error-reporter.js` exists — verify it:
  - Catches unhandled promise rejections
  - Sends WhatsApp alert to Frank on critical errors
  - Logs stack traces to `logs/` with rotation
  - Does NOT swallow errors silently

---

## Phase 3: Proactive Intelligence (GPT-5.5 + CC can do)

Atlas is currently reactive (responds when messaged) except for cron jobs. Make it smarter.

### 3.1 CompanyCam E2E verification
- `companycam-webhook.js` (319 LOC) is coded but untested
- Write integration test: simulate webhook payload → verify photo appears in Drive folder → verify WhatsApp notification sent
- Test the full flow: CompanyCam photo upload → webhook → Atlas → Drive + WhatsApp

### 3.2 Stale job detector
- Add cron job: daily scan of `workspace/jobs.json`
- Flag jobs with no CompanyCam activity in 3+ days
- Flag jobs with no email correspondence in 7+ days
- WhatsApp Frank: "3 jobs may be stalled: [list]"

### 3.3 Invoice aging alerts
- Scan jobs for outstanding invoices past 30/60/90 days
- Generate summary: "4 invoices past 30 days, total $X,XXX - $XX,XXX"
- Suggest: draft payment-nudge emails (using existing `payment-nudge.js`)

### 3.4 SSL/DNS/Site monitoring
- Daily cron: check SSL cert expiry for flood.doctor + all city subdomains
- Daily cron: HTTP health check on all 13 city sites
- Alert if any site returns non-200 or cert expires within 14 days

### 3.5 Structured Client Knowledge Pipeline

**Purpose:** Atlas should deeply understand Frank's business context — clients, invoices, adjuster responses, workflow patterns, claim status — without loading raw emails into every prompt.

**Core principle:** Extract once, query forever. Do not stuff raw Gmail/email threads into model context.

#### Three-tier knowledge architecture

**Tier 1 — Always-loaded business snapshot (< strict token cap)**
- Active client count, total open invoices, broad outstanding dollar range, this week's deadlines, top urgent items.
- Injected dynamically at runtime, not hardcoded into `config/system-prompt.md`.
- Stable system prompt stays stable. Volatile business state belongs in runtime context injection.

**Tier 2 — Structured client/job files (loaded on demand)**
- One JSON file per client/job: `workspace/clients/{client-slug}.json`
- Master lookup: `workspace/clients-index.json`
- Atlas loads relevant client file only when Frank mentions a client name, job number, address, adjuster, or insurer.
- Fields: schema_version, client_slug, name, job_address, insurance_company, adjuster_name, adjuster_contact, loss_date, key dates, line_items_count, total_submitted_range, total_paid, dispute info, last_communication_date, last_communication_summary, notes, last_indexed_at, sources.

**Tier 3 — Raw archive (accessed rarely)**
- Full Gmail threads remain in Gmail.
- Access raw messages only when exact wording, direct quotes, or verification are required.
- Use `gws-frankd gmail` commands to fetch specific messages/threads on demand.
- Do not store raw email bodies in always-loaded context or client JSON files.

#### Planned features (do not build until after mini2 production activation)

1. **`src/features/client-indexer.js`**
   - Plugin contract: `export function register(gateway)`
   - Manual commands first: `/reindex recent`, `/reindex client <name>`, `/reindex all`
   - Weekly cron only after manual commands are proven.
   - Uses `gws-frankd` with scoped Gmail queries (last 90 days).
   - Groups threads by client/job using subject patterns, known addresses, `workspace/jobs.json`.
   - Extracts structured fields into `workspace/clients/{slug}.json`.
   - Uses Gemini Flash for cheap extraction if `GEMINI_API_KEY` is available; regex/heuristic fallback otherwise.
   - Stores source pointers, not raw email bodies.

2. **`src/features/knowledge-loader.js`**
   - Plugin contract: `export function register(gateway)`
   - Hooks into agent context pipeline before Claude sees the message.
   - Scans Frank's message for client names, job numbers, addresses, adjusters, insurers.
   - If match in `workspace/clients-index.json`, loads that client/job JSON into runtime context.
   - Injects Tier 1 business snapshot into runtime context.
   - Does NOT import `client-indexer.js`. Shared file format, zero feature coupling.

3. **`workspace/knowledge/` manually curated files (future)**
   - `pushback-patterns.json` — common adjuster objections + proven responses.
   - `workflow-rules.json` — pricing logic, escalation criteria, lien thresholds, IICRC references.
   - `voice-guide.md` — Frank's writing style (measured, direct, email-first).
   - Manually curated or separately reviewed, not auto-generated from emails.

#### Cost strategy
- Gemini Flash for bulk extraction, not Opus.
- Opus only for high-value reasoning and final drafting.
- Load 500–5,000 tokens from structured client JSON when relevant, instead of 100K+ raw email tokens.
- Reindex on demand first, then weekly cron later.
- Raw Gmail access only for exact quotes or verification.

#### Design constraints
- 1 feature = 1 file = 1 commit. No cross-feature imports.
- Delete `client-indexer.js` → Atlas still works. Delete `knowledge-loader.js` → Atlas still works.
- `client-indexer.js` writes JSON. `knowledge-loader.js` reads JSON. Shared format, not code.
- All paths through `config.paths`.
- No raw Gmail context stuffing. No secrets in JSON files.
- Source pointers required for important extracted claims.
- `schema_version` in every generated JSON file.

#### Guardrails
- Build only after mini2 production activation is complete.
- Do not modify `config/system-prompt.md` to include volatile client data directly.
- Runtime context injection handles daily/client knowledge.
- Start with manual `/reindex` commands before weekly cron.
- Include `schema_version` and source pointers from day one.
- Keep Tier 1 snapshot under a strict token cap (target: <2K tokens).

#### Existing assets to leverage
- `workspace/jobs.json` — 60+ jobs already imported from Drive.
- `workspace/xactimate-kb/` — Xactimate line items and scope templates.
- `src/features/email-watcher.js` — Gmail query patterns (reference only, do not import).
- `src/memory/manager.js` — complementary observation memory.
- `flood-doctor-comms` skill — voice samples and IICRC references.

### 3.6 SEO pulse integration
- Connect to Mission Control's GSC data (if MC is running on primary Mac, Atlas on mini2 can hit `http://<primary-ip>:3001/api/`)
- Daily cron: check for position drops > 5 on tracked keywords
- Weekly summary: top gainers/losers, new keywords ranking

---

## Phase 4: Cost Optimization (GPT-5.5 + CC can do)

### 4.1 Add Gemini as a secondary model
- `GEMINI_API_KEY` is already set on mini2
- Add `src/providers/gemini-provider.js` following the `base-provider.js` interface
- Use Gemini Flash for:
  - Message classification (is this a customer inquiry, status check, or complex task?)
  - Simple data extraction (pull date/amount from an email)
  - Health checks and status formatting
- Keep Claude for:
  - Customer correspondence drafting
  - Xactimate scope analysis
  - Complex reasoning and multi-step tasks
- Update `model-router.js` to include Gemini tier below Haiku

### 4.2 Context budget enforcement
- `context-budget.js` exists — verify it:
  - Tracks token usage per conversation
  - Summarizes and resets when approaching limits
  - Prevents runaway conversations that burn through API credits

---

## Phase 5: Xactimate & Scope Completion (GPT-5.5 + CC can do)

### 5.1 Scope-draft generator
- `scope-assistant.js` (895 LOC) collects field data but doesn't emit Xactimate-formatted output
- Add: take collected room data → map to Xactimate line items using `workspace/xactimate-kb/line-items.json`
- Output: structured scope sheet that Frank can review before importing to Xactimate
- This saves Frank hours per invoice — it's his #1 time sink

### 5.2 Voice-to-scope (stretch goal)
- Whisper API transcription of crew voice notes
- Parse transcription for: room names, damage descriptions, measurements, equipment used
- Feed into scope-assistant pipeline
- This is listed on the master roadmap but not started

---

## Phase 6: Mission Control Bridge (GPT-5.5 + CC can do)

### 6.1 Align Atlas ↔ MC schemas
- Atlas has `workspace/jobs.json` with 60+ jobs
- MC has its own claims tracker schema
- Define a shared job schema or write a sync adapter
- Atlas writes job updates → MC displays them in dashboard

### 6.2 Atlas as MC agent
- MC already has agent infrastructure (`ops/services/agentManager.js`)
- Register Atlas as an MC agent that can:
  - Receive tasks from MC dashboard
  - Report results back to MC
  - Show Atlas status in MC UI

---

## Phase 7: Documentation & Cleanup (GPT-5.5 + CC can do)

### 7.1 Update stale docs
- `ATLAS-MASTER-ROADMAP.md` lists Phases 3-6 as "BUILD NEXT" — they're built
- Update to reflect actual state
- Add architecture diagram to README.md

### 7.2 Create README.md
- Currently missing
- Include: what Atlas is, setup instructions, environment variables needed (names only, not values), how to start/stop, how to run tests

### 7.3 Clean up OpenClaw references
- Frank has an older OpenClaw/clawbox setup that overlaps with Atlas
- Decision: Atlas on mini2 is the canonical assistant
- Remove or archive any OpenClaw configs that conflict

---

## Execution Order (Revised 2026-05-26)

```
IMMEDIATE → Phase 1.2 (path migration — unblocks everything else)
         → Phase 1.1 (create .env on mini2)
         → Phase 1.3-1.5 (launchd + tunnel on mini2)
         → Phase 2.2 (CI — quick win, 10 minutes)

Phase 0  → Frank (human tasks — Meta registration, key rotation) — DO IN PARALLEL

THEN     → Phase 3 (proactive features — highest business value)
         → Phase 4 (Gemini integration — cost savings)
         → Phase 5 (Xactimate — Frank's #1 time saver)
         → Phase 6 (MC bridge — connects the ecosystem)
         → Phase 7 (docs — do alongside other phases)
```

Phase 1.2 (path migration) is the GATE. Nothing else works on mini2 until paths are machine-agnostic.

---

## Rules for GPT-5.5 + CC

1. **One feature = one file = one commit.** This is the cc-wag design contract. Do not violate it.
2. **Delete any feature file → Atlas still works.** Zero coupling between features.
3. **All paths must be machine-agnostic** — use `process.env.HOME` or `os.homedir()`, not hardcoded `/Users/ghost/` or `/Users/ghost2/`
4. **Never commit .env, credentials, or secrets**
5. **Run `npm test` after every change** — all tests must pass
6. **Commit to main only** — no branches unless Frank explicitly asks
7. **Read files before editing them**
8. **Use `grep -c` or `grep -l` only when checking for secrets** — never print secret values
9. **When in doubt, ask Frank** — don't guess on business logic

---

## Success Criteria

Atlas is "production-ready" when:
- [ ] WhatsApp send/receive works via Twilio (not sandbox)
- [ ] All leaked credentials rotated
- [ ] Atlas runs on mini2 via launchd, survives reboots
- [ ] `atlas.vaserv.pro/health` returns healthy
- [ ] 15+ test files, all passing
- [ ] CI runs on every push
- [ ] Morning briefing arrives on Frank's WhatsApp by 7am daily
- [ ] Stale job alerts fire automatically
- [ ] Invoice aging alerts fire weekly
- [ ] Gemini handles classification, Claude handles reasoning
- [ ] Scope-assistant generates Xactimate-formatted output
- [ ] Frank can text "Atlas, what's my day look like?" and get a useful answer within 10 seconds
