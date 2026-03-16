# Atlas Feature Roadmap — Comprehensive Research & Spec

> Generated: 2026-03-16
> Author: Claude Code research synthesis
> Project: CC-WAG (~/Projects/cc-wag/)
> Current Version: 1.0.0

---

## Table of Contents

1. [Current Capabilities Audit](#1-current-capabilities-audit)
2. [Competitive Analysis](#2-competitive-analysis)
3. [Unused WhatsApp/Baileys Features](#3-unused-whatsappbaileys-features)
4. [AI Agent Framework Capabilities](#4-ai-agent-framework-capabilities)
5. [Feature Proposals — Frank's Workflow](#5-feature-proposals)
6. [Tier Prioritization](#6-tier-prioritization)
7. [Architecture Considerations](#7-architecture-considerations)

---

## 1. Current Capabilities Audit

### What Atlas Already Does

| Category | Feature | Status |
|----------|---------|--------|
| **Messaging** | Text send/receive | ✅ |
| **Messaging** | Image receive + vision analysis | ✅ |
| **Messaging** | Image send | ❌ |
| **Messaging** | Reactions (emoji) | ✅ |
| **Messaging** | Typing indicators | ✅ |
| **Messaging** | Location pin send | ✅ |
| **Messaging** | Voice messages | ❌ |
| **Messaging** | Document send/receive | ❌ |
| **Messaging** | Buttons/lists/polls | ❌ |
| **Messaging** | Quote replies | ❌ |
| **Messaging** | Contact cards | ❌ |
| **Identity** | Self-chat mode (CC, prefix) | ✅ |
| **Identity** | Team DM mode (Atlas trigger) | ✅ |
| **Identity** | Group mention response | ✅ |
| **Identity** | Active session with 30min timeout | ✅ |
| **Google** | Gmail (personal + work) | ✅ |
| **Google** | Calendar (agenda, create events) | ✅ |
| **Google** | Tasks (add, list, complete) | ✅ |
| **Google** | Drive (search, list files) | ✅ |
| **Memory** | Long-term (MEMORY.md) | ✅ |
| **Memory** | Daily logs (YYYY-MM-DD.md) | ✅ |
| **Memory** | Search across memory files | ✅ |
| **Scheduling** | One-time delayed reminders | ✅ |
| **Scheduling** | Recurring intervals | ✅ |
| **Scheduling** | Cron expressions | ✅ |
| **Scheduling** | Agent-invoked cron (smart jobs) | ✅ |
| **Location** | /whereisfrank GPS via Tasker+Join | ✅ |
| **Commands** | /new, /status, /memory, /model, /todo, /queue, /help, /stop | ✅ |
| **Email** | Branded HTML templates (Flood Doctor, Restoration Doctor) | ✅ |
| **Email** | Multi-alias routing (6 send-as addresses) | ✅ |
| **Agent** | Model switching (Opus/Sonnet/Haiku) | ✅ |
| **Agent** | Tool approval workflow | ✅ |
| **Agent** | Session persistence (SDK resume) | ✅ |
| **Agent** | Queue-based message processing | ✅ |
| **Infra** | HTTP API (health, QR, send) | ✅ |
| **Infra** | launchd daemon mode | ✅ |
| **Proactive** | Morning briefings | ❌ |
| **Proactive** | Alerts & nudges | ❌ |
| **Business** | CompanyCam integration | ❌ |
| **Business** | Invoice pipeline | ❌ |
| **Business** | Job/client management | ❌ |
| **Business** | Revenue/metrics dashboard | ❌ |

---

## 2. Competitive Analysis

### What Top VAs Offer That Atlas Doesn't

#### Google Assistant
- **Morning routines**: Automated daily briefing (weather, calendar, commute, news, reminders)
- **Proactive suggestions**: "Leave now to make your 2pm meeting" based on calendar + traffic
- **Smart home control**: Lights, thermostat, cameras, locks via voice
- **Interpreter mode**: Real-time translation
- **Contextual follow-ups**: "What about tomorrow?" after asking about today's weather
- **Broadcast messages**: "Hey Google, broadcast dinner is ready" to all devices

**Relevance to Atlas**: Morning briefings, proactive calendar nudges, contextual awareness

#### Apple Siri / Apple Intelligence
- **Shortcuts**: Multi-step automation chains triggered by voice/widget
- **On-device processing**: Privacy-first local inference
- **App Intents**: Deep integration with any app's actions
- **Proactive intelligence**: Suggested actions based on behavior patterns
- **Focus modes**: Context-aware notification filtering

**Relevance to Atlas**: Workflow shortcuts (e.g., "Start a job for [client]" triggers multi-step pipeline)

#### Amazon Alexa
- **Flash briefings**: Curated news + weather + calendar summary
- **Skills ecosystem**: 100K+ third-party integrations
- **Routines**: Multi-step automations on triggers (time, location, voice)
- **Drop-in calling**: Intercom-style calling between devices
- **Lists management**: Shared household/team lists
- **Guard mode**: Audio anomaly detection (glass breaking, smoke alarm)

**Relevance to Atlas**: Flash briefing pattern, routine automation, shared team lists

#### Microsoft Copilot
- **Meeting summaries**: Auto-summarize Teams meetings with action items
- **Email drafting**: Contextual email composition from thread history
- **Document intelligence**: Summarize, analyze, create from any Office doc
- **Workflow automation**: Power Automate integration for business processes
- **Enterprise search**: Cross-app content search (email, files, chat, calendar)

**Relevance to Atlas**: Email drafting from context, document intelligence, cross-app search

#### Rabbit R1 / Humane AI Pin (LAM Concept)
- **Large Action Model**: Execute multi-step tasks across apps via natural language
- **App-less interaction**: No need to open apps — just describe what you want
- **Visual understanding**: Camera-based real-time analysis
- **Context persistence**: Remembers ongoing tasks across sessions

**Relevance to Atlas**: Multi-step task execution is already possible via Claude Agent SDK tools

#### Lindy AI
- **Meeting preparation**: Auto-research attendees before meetings
- **CRM auto-update**: Log calls, emails, meetings to CRM automatically
- **Follow-up drafting**: Auto-draft follow-up emails after meetings
- **Lead scoring**: Analyze inbound leads and prioritize
- **Knowledge base Q&A**: Answer questions from company documents

**Relevance to Atlas**: Meeting prep, follow-up drafting, lead scoring for restoration jobs

#### Zapier AI / Make AI
- **Multi-app workflows**: Chain 5000+ app integrations
- **Conditional logic**: If/then branching in automations
- **AI-powered parsing**: Extract structured data from unstructured input
- **Scheduled automations**: Time-based triggers

**Relevance to Atlas**: Already has better tool use via Claude SDK; Zapier-like patterns achievable natively

### Key Gaps Summary (Atlas vs Competition)

| Gap | Who Does It Best | Impact for Frank |
|-----|-----------------|------------------|
| Morning briefings | Google Assistant, Alexa | HIGH — daily overview of schedule, emails, tasks |
| Proactive alerts | Google Assistant, Siri | HIGH — "Leave now for meeting", "Invoice overdue" |
| Voice messages | All consumer VAs | HIGH — hands-free while on job sites |
| Document handling | Copilot, Lindy | HIGH — send/receive PDFs, contracts, photos |
| Meeting prep | Lindy, Copilot | MEDIUM — research clients before meetings |
| Smart home / IoT | Alexa, Google | LOW — not core business need |
| Multi-step routines | Alexa, Siri Shortcuts | HIGH — "Start job" = create task + calendar + notify crew |
| Cross-app search | Copilot | MEDIUM — search across email, drive, tasks at once |
| Follow-up nudges | Lindy | HIGH — "You haven't invoiced Smith job from 2 weeks ago" |

---

## 3. Unused WhatsApp/Baileys Features

### Available in Baileys (Not Yet Implemented)

#### 3.1 Send Images
```js
await sock.sendMessage(jid, {
  image: fs.readFileSync('./photo.jpg'),
  caption: 'Job site photo'
})
```
**Use case**: Send CompanyCam photos, invoice PDFs as images, charts/reports

#### 3.2 Send Documents
```js
await sock.sendMessage(jid, {
  document: fs.readFileSync('./invoice.pdf'),
  mimetype: 'application/pdf',
  fileName: 'Invoice-Smith-2026.pdf'
})
```
**Use case**: Send contracts, invoices, scopesheets, floor plans directly via WhatsApp

#### 3.3 Voice Messages (Audio)
```js
// Send voice note (OGG Opus format)
await sock.sendMessage(jid, {
  audio: fs.readFileSync('./message.ogg'),
  mimetype: 'audio/ogg; codecs=opus',
  ptt: true  // ptt = push-to-talk (voice note style)
})

// Receive: downloadMediaMessage(msg) for audio messages
```
**Use case**: Receive voice notes from Frank/team, transcribe with Whisper/Claude, respond with TTS

#### 3.4 Buttons (Quick Reply)
```js
await sock.sendMessage(jid, {
  text: 'Approve this invoice?',
  buttons: [
    { buttonId: 'approve', buttonText: { displayText: 'Approve' } },
    { buttonId: 'reject', buttonText: { displayText: 'Reject' } },
    { buttonId: 'edit', buttonText: { displayText: 'Edit' } }
  ]
})
```
**Note**: WhatsApp has been restricting button support for unofficial API (Baileys). May not render on all clients. Use with fallback.

**Use case**: Approval flows, quick selections, confirmation prompts

#### 3.5 List Messages
```js
await sock.sendMessage(jid, {
  text: 'Select a task list:',
  buttonText: 'View Options',
  sections: [{
    title: 'Task Lists',
    rows: [
      { title: 'Flood Doctor', rowId: 'fd' },
      { title: 'Personal', rowId: 'personal' },
      { title: 'Urgent', rowId: 'urgent' }
    ]
  }]
})
```
**Note**: Same restriction caveat as buttons.

**Use case**: Menu navigation, task/client selection, model picking

#### 3.6 Polls
```js
await sock.sendMessage(jid, {
  poll: {
    name: 'Which job site first today?',
    values: ['Smith - Arlington', 'Jones - Fairfax', 'Wilson - Vienna'],
    selectableCount: 1
  }
})
```
**Use case**: Crew scheduling, priority voting, quick team decisions

#### 3.7 Quote Replies
```js
await sock.sendMessage(jid, {
  text: 'Response text',
  quoted: originalMessage  // msg object from messages.upsert
}, { quoted: originalMessage })
```
**Use case**: Reply to specific messages in group chats, reference specific questions

#### 3.8 Contact Cards (vCard)
```js
const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:Flood Doctor\nTEL:+18774970007\nEND:VCARD`
await sock.sendMessage(jid, { contacts: { displayName: 'Flood Doctor', contacts: [{ vcard }] } })
```
**Use case**: Share company contact, vendor contacts, client contact info

#### 3.9 Video Messages
```js
await sock.sendMessage(jid, {
  video: fs.readFileSync('./video.mp4'),
  caption: 'Job walkthrough',
  gifPlayback: false
})
```
**Use case**: Receive job site videos from crew, send instructional clips

#### 3.10 Stickers
```js
await sock.sendMessage(jid, {
  sticker: fs.readFileSync('./sticker.webp')
})
```
**Use case**: Low priority — fun personality touch for Atlas

#### 3.11 Message Editing
```js
await sock.sendMessage(jid, {
  text: 'Corrected text',
  edit: originalMessage.key
})
```
**Use case**: Fix typos in bot responses, update status messages

#### 3.12 Message Deletion
```js
await sock.sendMessage(jid, { delete: originalMessage.key })
```
**Use case**: Clean up error messages, remove sensitive data after viewing

#### 3.13 Read Receipts
```js
await sock.readMessages([message.key])
```
**Use case**: Mark messages as read to show Atlas processed them

#### 3.14 Forward Messages
```js
await sock.sendMessage(targetJid, {
  forward: originalMessage
})
```
**Use case**: Forward messages between Frank and team members, relay client messages

#### 3.15 Group Management
```js
await sock.groupCreate('Job Site - Smith', [participant1, participant2])
await sock.groupUpdateSubject(groupJid, 'New Group Name')
await sock.groupUpdateDescription(groupJid, 'Job description')
await sock.groupParticipantsUpdate(groupJid, [participant], 'add')
```
**Use case**: Auto-create job site groups, manage crew group membership

#### 3.16 Status/Stories
```js
await sock.sendMessage('status@broadcast', {
  text: 'Flood Doctor - Open for emergency calls 24/7'
})
```
**Use case**: Post company updates, availability status

---

## 4. AI Agent Framework Capabilities

### Claude Agent SDK — Advanced Features Already Available

The Claude Agent SDK (v0.1.0, already installed) supports features not yet used:

| Feature | Status | Potential |
|---------|--------|-----------|
| `query()` streaming with tool use | ✅ Used | — |
| Session resume (conversation persistence) | ✅ Used | — |
| MCP server integration | ✅ Used (cron, gateway) | Add more MCP servers |
| `canUseTool` callback (approval flow) | ✅ Used | Expand to smarter approval |
| `permissionMode: 'bypassPermissions'` | ✅ Used | — |
| Multi-model routing per query | 🟡 Manual via /model | Auto-route by complexity |
| Sub-agent spawning | ❌ Not used | Parallel task execution |
| Structured output | ❌ Not used | JSON responses for data extraction |
| Computer use (browser actions) | ❌ Not used | Web form filling, portal access |
| Image generation (via tool) | ❌ Not used | Generate reports, charts |

### Key Framework Capabilities to Implement

#### 4.1 Proactive Agent (Agent Initiates Without User Prompt)
- **What**: Atlas sends messages unprompted based on triggers
- **How**: Already have cron infrastructure. Extend with:
  - Calendar-aware crons that check schedule and send briefings
  - Gmail watchers that alert on urgent emails
  - Task deadline monitors that send nudges
- **Complexity**: LOW — extend existing cron system with `invokeAgent: true`

#### 4.2 Multi-Step Planning
- **What**: Break complex requests into sub-tasks, execute sequentially
- **How**: Claude already does this via tool chains. Improve with:
  - Explicit plan display before execution
  - Checkpoint/rollback for destructive operations
  - Progress updates during long operations
- **Complexity**: LOW — Claude does this natively, just need UX improvements

#### 4.3 RAG / Knowledge Base
- **What**: Answer questions from company documents without loading full files each time
- **How**:
  - Index key documents (invoice knowledge, Xactimate prices, company policies)
  - Store embeddings locally or use semantic search
  - Query relevant chunks when answering business questions
- **Complexity**: MEDIUM — need embedding generation + vector search

#### 4.4 Workflow Templates (Routines)
- **What**: Named multi-step workflows triggered by a single command
- **How**: Define workflow templates in JSON/YAML:
  ```
  /routine morning -> check calendar + check email + check tasks + weather -> send summary
  /routine newjob <client> -> create Google Task + create Drive folder + notify crew
  /routine invoice <client> -> pull CompanyCam photos + generate timeline + draft invoice
  ```
- **Complexity**: MEDIUM — need workflow engine + template system

#### 4.5 Smart Model Routing
- **What**: Auto-select model based on task complexity
- **How**:
  - Haiku for simple questions, reminders, task creation
  - Sonnet for email drafting, document analysis, multi-step tasks
  - Opus for complex reasoning, invoice audits, strategic decisions
- **Complexity**: LOW — classify intent, set model per query

#### 4.6 Voice Integration
- **What**: Receive voice notes, transcribe, respond with voice
- **How**:
  - Receive: Baileys `downloadMediaMessage()` -> Whisper API or Claude audio
  - Send: TTS API (Google Cloud TTS, ElevenLabs, OpenAI TTS) -> OGG Opus -> Baileys send audio
- **Complexity**: MEDIUM — need audio processing pipeline

---

## 5. Feature Proposals — Tailored to Frank's Workflow

### F01: Morning Briefing
**What**: Daily automated message at ~7:30 AM with:
- Today's calendar events (from gws)
- Unread urgent emails (from gws, filtered by sender/subject)
- Overdue Google Tasks (from gws)
- Weather forecast for Northern Virginia
- Any pending invoice deadlines
- Crew schedule reminders

**Why**: Frank juggles multiple businesses and projects. Starting each day with a consolidated view eliminates the need to check 5+ apps. Every major VA (Google, Alexa, Siri) does this.

**Technical Approach**:
1. Create a cron job with `invokeAgent: true` at `30 7 * * 1-6` (7:30 AM Mon-Sat)
2. Agent message: "Generate my morning briefing: check calendar, urgent emails, overdue tasks, and today's weather for Vienna, VA"
3. Agent uses existing gws CLI tools to gather data
4. Weather via `curl wttr.in/Vienna,VA?format=...` or OpenWeather API
5. Format as concise WhatsApp message with sections separated by line breaks

**Dependencies**: Weather API key (free tier sufficient), existing gws CLI
**Effort**: ~2 hours

---

### F02: Proactive Calendar Alerts
**What**: Smart reminders before calendar events:
- 30 min before meetings: "Meeting with [person] in 30 min at [location]"
- Drive time alerts: "Leave now for your 2pm in Arlington (35 min drive)"
- Day-before prep: "Tomorrow: inspection at Smith property. CompanyCam photos needed."

**Why**: Google Assistant's best feature is proactive calendar awareness. Frank is often on job sites and loses track of time.

**Technical Approach**:
1. Recurring cron job every 15 minutes with `invokeAgent: true`
2. Agent checks calendar for upcoming events in next 45 min
3. If event found and no alert already sent, send WhatsApp message
4. Track sent alerts in workspace/alerts-sent.json to avoid duplicates
5. Optional: Google Maps API for drive time estimates

**Dependencies**: Existing gws calendar, optional Google Maps API key
**Effort**: ~3 hours

---

### F03: Voice Message Support
**What**:
- Receive voice notes from Frank/team -> transcribe -> process as text
- Optionally respond with voice notes (TTS)

**Why**: Frank is often on job sites, driving, or working with his hands. Voice is the most natural input while mobile. Every consumer VA is voice-first.

**Technical Approach**:
1. **Receive**: In `whatsapp.js handleMessage()`, detect `msg.message?.audioMessage`
2. Download audio via `downloadMediaMessage(msg)`
3. Transcribe using:
   - Option A: Claude's native audio understanding (if supported in Agent SDK)
   - Option B: OpenAI Whisper API (`/v1/audio/transcriptions`)
   - Option C: Google Cloud Speech-to-Text
4. Pass transcribed text to agent as regular message with `[Voice Note Transcription]` prefix
5. **Send (optional)**: Use TTS API -> convert to OGG Opus -> `sock.sendMessage(jid, { audio, ptt: true })`

**Dependencies**: Whisper API key or Google STT credentials; ffmpeg for audio conversion
**Effort**: ~4 hours (receive), ~6 hours (send TTS)

---

### F04: Document Handling (Send/Receive PDFs, Photos)
**What**:
- Send PDFs, images, documents via WhatsApp
- Receive documents and extract/analyze content
- "Send me the Smith contract" -> Atlas finds it on Drive and sends via WhatsApp

**Why**: Frank needs to share invoices, contracts, scopesheets, and photos with clients and team. Currently has to manually navigate Drive and share links. Atlas should handle this directly.

**Technical Approach**:
1. **Send documents**: Add `sendDocument(chatId, buffer, filename, mimetype)` to WhatsApp adapter
   ```js
   await sock.sendMessage(jid, { document: buffer, mimetype, fileName })
   ```
2. **Send images**: Add `sendImage(chatId, buffer, caption)` to WhatsApp adapter
   ```js
   await sock.sendMessage(jid, { image: buffer, caption })
   ```
3. **Receive documents**: In handleMessage(), detect `msg.message?.documentMessage`
   - Download via `downloadMediaMessage(msg)`
   - For PDFs: extract text via `pdf-parse` or Claude vision
   - For images: already handled
4. **Drive integration**: New gateway MCP tool `send_drive_file` that:
   - Searches Drive by filename/query
   - Downloads file via gws CLI
   - Sends via WhatsApp adapter
5. Add MCP tools: `mcp__gateway__send_image`, `mcp__gateway__send_document`, `mcp__gateway__send_drive_file`

**Dependencies**: `pdf-parse` npm package (optional), existing gws CLI
**Effort**: ~6 hours

---

### F05: CompanyCam Integration
**What**:
- "Show me photos from the Smith job" -> fetch from CompanyCam API, send via WhatsApp
- "What's the latest update on [project]?" -> check CompanyCam activity
- "How many air movers at the Jones site?" -> analyze latest photos
- Proactive alerts when new photos are uploaded to active projects

**Why**: CompanyCam is central to Frank's invoicing pipeline. Currently requires switching to the app or browser. Direct WhatsApp access saves context switching.

**Technical Approach**:
1. Create CompanyCam MCP server with tools:
   - `search_projects(query)` — search by address/name
   - `get_project_photos(project_id, limit)` — fetch recent photos
   - `get_photo_url(photo_id)` — get downloadable URL
   - `get_project_activity(project_id)` — recent activity log
2. Use CompanyCam REST API (key in ~/.claude/credentials.local)
3. Download photos -> send via WhatsApp adapter's sendImage
4. For analysis: send photo to Claude vision for equipment counting
5. Optional cron: check active projects for new photos every hour

**Dependencies**: CompanyCam API key (already have), F04 (send images)
**Effort**: ~8 hours

---

### F06: Smart Invoice Assistant
**What**:
- "Start invoice for [client]" -> pulls CompanyCam photos + timeline + equipment counts
- "What's missing from the Smith invoice?" -> audits against Xactimate knowledge base
- "Generate supervisory hours for [project]" -> builds timeline from photo timestamps
- Draft invoice review with line-by-line confidence scores

**Why**: Frank has ~40 invoices to write, each worth $5K-$16K. The CompanyCam-to-invoice pipeline is his highest-value workflow. Even 10% improvement = thousands of dollars recovered.

**Technical Approach**:
1. Build on F05 (CompanyCam integration)
2. Create invoice MCP server:
   - `start_invoice(client_name)` — init invoice workspace
   - `pull_project_data(project_id)` — CompanyCam photos + timeline
   - `analyze_equipment(photos)` — count air movers, dehumidifiers, HEPA scrubbers
   - `build_timeline(photos)` — supervisory hours from EXIF timestamps
   - `audit_scope(draft, knowledge_base)` — compare against Xactimate price list
3. Knowledge base: index ~/flood-doctor/invoice-knowledge.md + Xactimate CSV
4. Output: structured invoice draft with evidence tags (CONFIRMED/DERIVED/ESTIMATED)

**Dependencies**: F05, CompanyCam API, Xactimate price list CSV
**Effort**: ~16 hours (complex, high value)

---

### F07: Follow-Up Nudges & Task Deadline Alerts
**What**:
- "You haven't followed up with StateFarm about the Smith claim in 5 days"
- "Invoice for Jones is 14 days overdue"
- "Your meeting with the adjuster is tomorrow - prep needed?"
- Track commitments made in conversations and nudge when overdue

**Why**: Frank makes verbal commitments in conversations that slip through the cracks. Proactive nudging prevents revenue loss and maintains client relationships.

**Technical Approach**:
1. Extend memory system to track "commitments":
   - When Frank says "I'll send that tomorrow" or "Follow up with X", Atlas logs it
   - Commitment structure: { what, who, deadline, status }
   - Store in workspace/commitments.json
2. Daily cron job scans commitments and overdue tasks
3. Alert on overdue items with context
4. Also scan Google Tasks for items past due date
5. New /commitments command to list active commitments

**Dependencies**: Existing cron + memory system
**Effort**: ~5 hours

---

### F08: Quote Replies & Message Context
**What**:
- Atlas replies to specific messages (quote reply) in groups
- Better context tracking in group conversations
- Thread-aware responses

**Why**: In group chats, context gets lost. Quote replies make it clear what Atlas is responding to. Essential for crew coordination groups.

**Technical Approach**:
1. Pass `msg` object through the pipeline so agent can reference it
2. In runner.js `executeRun`, when sending response, use:
   ```js
   await sock.sendMessage(chatId, { text: response }, { quoted: originalMsg })
   ```
3. Store recent message objects per chat for reference
4. Add gateway MCP tool: `reply_to_message(chat_id, message_id, text)`

**Dependencies**: None (Baileys already supports)
**Effort**: ~3 hours

---

### F09: Business Intelligence Dashboard via WhatsApp
**What**:
- "How's the business this week?" -> revenue, active jobs, pipeline, pending invoices
- "How many leads came in this month?" -> aggregate from email/calendar data
- Weekly automated business summary (every Sunday evening)

**Why**: Frank makes strategic decisions based on business health. Quick pulse checks via WhatsApp eliminate the need to log into multiple dashboards.

**Technical Approach**:
1. Aggregate data from available sources:
   - Google Calendar: count client meetings, inspections
   - Google Tasks: count active/completed tasks per list
   - Gmail: count inbound leads (filter by subject patterns)
   - CompanyCam: active project count
   - Mission Control API (localhost:3001): SEO metrics
2. Create business intelligence MCP server:
   - `get_weekly_summary()` — aggregate all sources
   - `get_pipeline_status()` — jobs by stage
   - `get_lead_count(period)` — inbound lead tracking
3. Weekly cron job (Sunday 6 PM) sends automated summary
4. On-demand via "How's business?" trigger

**Dependencies**: F05 (CompanyCam), Mission Control API
**Effort**: ~8 hours

---

### F10: Crew/Team Features
**What**:
- Team members ask Atlas: "What's my schedule today?" -> Atlas checks Frank's calendar for assignments
- "Tell Frank I finished the extraction at Smith" -> Atlas logs completion + notifies Frank
- Atlas can relay messages between Frank and crew
- Job assignment notifications: "Frank assigned you to the Wilson inspection at 2pm"

**Why**: Frank's crew currently relies on direct calls/texts. Atlas as middleman enables async communication and creates an audit trail.

**Technical Approach**:
1. Build team member registry in workspace/team.json:
   ```json
   { "phone": "+1...", "name": "John", "role": "field_tech", "permissions": ["schedule", "tasks", "relay"] }
   ```
2. Extend Atlas system prompt with team member context when `isAtlas` flag is set
3. Add MCP tools:
   - `relay_to_frank(message, from)` — save note + create task + send to Frank's self-chat
   - `relay_to_team(phone, message)` — send message from Frank via Atlas
   - `get_team_schedule(date)` — pull assignments from calendar
4. Forward messages using Baileys forward API
5. Track team message relay log

**Dependencies**: Team member phone numbers in allowedDMs
**Effort**: ~6 hours

---

### F11: Weather Integration
**What**:
- "What's the weather today?" -> current conditions + forecast
- Proactive severe weather alerts (important for water damage company!)
- "Will it rain this week?" -> 7-day forecast for planning outdoor work

**Why**: Weather directly impacts Frank's business — storms = emergency calls, rain = site delays. Every major VA includes weather.

**Technical Approach**:
1. Free weather API: OpenWeather (free tier: 1000 calls/day) or wttr.in (no key needed)
2. Add weather MCP tool:
   - `get_weather(location)` — current + forecast
   - `get_severe_alerts(location)` — NWS severe weather alerts
3. Include in morning briefing (F01)
4. Optional: Proactive severe weather cron that checks NWS alerts every 30 min
   - If severe thunderstorm/flood watch in NoVA, alert Frank immediately
   - "WEATHER ALERT: Flash flood warning for Fairfax County. Expect increased call volume."

**Dependencies**: OpenWeather API key (free) or none (wttr.in)
**Effort**: ~2 hours (basic), ~4 hours (with severe alerts)

---

### F12: Emergency Mode
**What**:
- Beyond /whereisfrank: SOS feature that shares location + notifies emergency contacts
- "Emergency" trigger activates full protocol:
  1. Get GPS location
  2. Share with emergency contacts list
  3. Call designated number via Tasker
  4. Log incident with timestamp
- Quick safety check-in for crew on remote job sites

**Why**: Field work can be dangerous — water damage sites have structural risks, mold exposure, electrical hazards. Safety protocol beyond location sharing.

**Technical Approach**:
1. Emergency contacts in workspace/emergency-contacts.json
2. /sos command or "emergency" keyword detection
3. Chain: requestLocation() -> broadcast location to contacts -> trigger Tasker call
4. Optional: periodic safety check-in cron for active job sites
   - "John hasn't checked in from the Smith site in 4 hours" -> alert Frank

**Dependencies**: F04 (location sharing already exists), Tasker automation
**Effort**: ~4 hours

---

### F13: Smart Home / IoT Integration
**What**:
- Control office/home devices via WhatsApp
- "Turn on the office lights" / "Set thermostat to 72"
- "Is the office alarm armed?"
- Water leak sensor alerts forwarded to WhatsApp

**Why**: Nice-to-have but low business impact. More relevant: water leak sensors at client job sites during drying period.

**Technical Approach**:
1. If using Home Assistant: HA REST API integration
2. If using Google Home: via Google Home API or gws CLI
3. Create home MCP server with device control tools
4. Water leak sensor: webhook receiver that forwards alerts to WhatsApp

**Dependencies**: Smart home platform API access
**Effort**: ~8 hours (highly variable by platform)

---

### F14: Workflow Routines (Multi-Step Shortcuts)
**What**: Named workflows that chain multiple actions:
- `/routine morning` — Full morning briefing
- `/routine newjob <client> <address>` — Create task + Drive folder + CompanyCam project + notify crew + add calendar event
- `/routine closeout <client>` — Check final photos + generate timeline + start invoice draft + mark tasks complete
- `/routine weeklyreview` — Business summary + pending invoices + overdue tasks + next week preview

**Why**: Siri Shortcuts and Alexa Routines are among the most-used features. Frank's workflows are predictable and can be templated. Saves 10-15 minutes per routine execution.

**Technical Approach**:
1. Routine definitions in workspace/routines.json:
   ```json
   {
     "morning": {
       "description": "Morning briefing",
       "steps": [
         { "action": "invoke_agent", "prompt": "Check today's calendar and list events" },
         { "action": "invoke_agent", "prompt": "Check urgent unread emails from last 12 hours" },
         { "action": "invoke_agent", "prompt": "List overdue Google Tasks" },
         { "action": "bash", "command": "curl -s wttr.in/Vienna,VA?format=3" }
       ],
       "format": "briefing"
     }
   }
   ```
2. New /routine command in CommandHandler
3. Execute steps sequentially, collect results, format as single message
4. Allow creating new routines via conversation: "Create a routine called newjob that..."

**Dependencies**: None (all infrastructure exists)
**Effort**: ~6 hours

---

### F15: Smart Model Routing
**What**: Automatically select the best Claude model per query:
- Haiku: simple questions, task creation, reminders, status checks
- Sonnet: email drafting, document analysis, multi-tool tasks
- Opus: complex reasoning, invoice auditing, strategic analysis, research

**Why**: Cost optimization + speed. Most WhatsApp messages are simple (Haiku = fast + cheap). Reserve Opus for high-value tasks. Frank already wants this per project-decisions.md.

**Technical Approach**:
1. Intent classifier (can be rule-based initially):
   - Simple patterns: greetings, single-word commands, task add -> Haiku
   - Medium patterns: email draft, calendar query, file search -> Sonnet
   - Complex patterns: "analyze", "audit", "compare", "research", multi-paragraph -> Opus
2. Override: Frank can say "use opus for this" to force model
3. Track model usage + cost in workspace/model-usage.json
4. Set model on provider before query

**Dependencies**: None
**Effort**: ~3 hours

---

### F16: Message Formatting & Rich Media
**What**:
- Format responses with WhatsApp-native formatting (*bold*, _italic_, ~strikethrough~, ```monospace```)
- Send charts/graphs as images (generated via canvas/SVG)
- Inline buttons for common actions (with text fallback)

**Why**: Current responses are plain text. WhatsApp supports basic formatting that makes messages more scannable, especially for briefings and reports.

**Technical Approach**:
1. Update system prompt: use WhatsApp formatting (*bold* for headers, _italic_ for emphasis)
2. For charts: use `canvas` npm package or SVG -> PNG conversion
3. For buttons: attempt Baileys button API, fallback to numbered options
4. Detect response type and format accordingly

**Dependencies**: `canvas` npm package (for charts)
**Effort**: ~3 hours (formatting), ~6 hours (charts)

---

### F17: Mission Control Integration
**What**:
- "How's the SEO doing?" -> query Mission Control for rankings, traffic, GSC data
- "What's our top performing page?" -> GA4 metrics via MC API
- "Run a lighthouse audit on flood.doctor" -> trigger via MC
- Weekly SEO summary in WhatsApp

**Why**: Frank has Mission Control running at localhost:3001 with SEO tools. Accessing it via WhatsApp while mobile is more convenient than opening a browser.

**Technical Approach**:
1. Create Mission Control MCP server:
   - `get_seo_summary()` — rankings, traffic, top pages
   - `get_gsc_data(query, period)` — search console metrics
   - `run_audit(url)` — trigger Lighthouse audit
2. Connect via MC's HTTP API with X-MC-Token auth
3. Include in weekly business summary (F09)

**Dependencies**: Mission Control running at localhost:3001
**Effort**: ~4 hours

---

### F18: Google Drive Intake Monitor
**What**:
- Watch the intake folder for new scopesheets/floor plans
- Auto-file into correct client folder
- Notify Frank: "New scopesheet filed for [Client Name] in folder #37"

**Why**: Already partially documented in gdrive-scopesheet.md memory. Automating the filing workflow saves manual sorting time.

**Technical Approach**:
1. Cron job every 30 minutes: check intake folder via `gws drive files list`
2. For new files: extract client name from filename
3. Match against existing numbered folders
4. Move file via `gws drive files update --fileId X --addParents Y --removeParents Z`
5. Send WhatsApp notification with filing result
6. If no match: ask Frank for classification

**Dependencies**: Existing gws CLI, Google Drive folder structure
**Effort**: ~4 hours

---

### F19: Contact Management via WhatsApp
**What**:
- "Save this contact: John Smith, adjuster at StateFarm, 703-555-1234"
- "Send John Smith's contact to my crew group"
- "Who's the adjuster on the Wilson claim?" -> search contacts
- Maintain a business contacts database searchable via WhatsApp

**Why**: Frank deals with adjusters, clients, vendors, subcontractors. Quick contact lookup/sharing via WhatsApp is faster than searching phone contacts.

**Technical Approach**:
1. Contacts stored in workspace/contacts.json
2. MCP tools:
   - `save_contact(name, role, phone, email, company, notes)`
   - `search_contacts(query)`
   - `send_contact_card(chat_id, contact_id)` — sends vCard via Baileys
3. Auto-extract contact info from conversations ("Remember that John Smith is the adjuster")
4. Integrate with Google Contacts via gws

**Dependencies**: Baileys vCard support (section 3.8)
**Effort**: ~4 hours

---

### F20: Conversation Summaries & Handoff
**What**:
- "Summarize our conversation" -> digest of key decisions and action items
- End-of-day summary: what was discussed, what was decided, what's pending
- Context handoff between sessions: when /new is used, summary is saved to memory

**Why**: WhatsApp conversations are ephemeral on the UI. Atlas should capture institutional knowledge from conversations automatically.

**Technical Approach**:
1. On /new command: before resetting session, generate summary via agent
2. Save summary to daily memory log
3. Extract action items -> create Google Tasks automatically
4. New /summary command for on-demand recap
5. End-of-day cron that summarizes all day's conversations

**Dependencies**: Existing memory system
**Effort**: ~3 hours

---

## 6. Tier Prioritization

### Tier 1: High Impact, Buildable This Week
*Estimated total: ~25 hours*

| # | Feature | Effort | Impact | Justification |
|---|---------|--------|--------|---------------|
| F01 | Morning Briefing | 2h | ★★★★★ | Immediate daily value. Just a cron job + agent prompt. |
| F02 | Proactive Calendar Alerts | 3h | ★★★★★ | Prevents missed meetings. Cron + gws calendar. |
| F04 | Document Handling (Send) | 6h | ★★★★★ | Unlocks sending invoices, contracts, photos via WhatsApp. |
| F07 | Follow-Up Nudges | 5h | ★★★★☆ | Revenue protection. Catches dropped commitments. |
| F08 | Quote Replies | 3h | ★★★★☆ | Better UX in groups. Trivial Baileys feature. |
| F15 | Smart Model Routing | 3h | ★★★★☆ | Cost savings + speed improvement. Rule-based classifier. |
| F20 | Conversation Summaries | 3h | ★★★★☆ | Knowledge capture. Extends existing memory system. |

### Tier 2: High Impact, Needs Research/Setup
*Estimated total: ~35 hours*

| # | Feature | Effort | Impact | Justification |
|---|---------|--------|--------|---------------|
| F03 | Voice Message Support | 4-10h | ★★★★★ | Hands-free input. Needs Whisper API setup + audio pipeline. |
| F05 | CompanyCam Integration | 8h | ★★★★★ | Core business tool. Needs MCP server build. |
| F10 | Crew/Team Features | 6h | ★★★★☆ | Team coordination. Needs team registry + permission model. |
| F11 | Weather + Severe Alerts | 4h | ★★★★☆ | Business-critical for water damage company. API setup needed. |
| F14 | Workflow Routines | 6h | ★★★★☆ | Huge time saver. Needs routine engine design. |
| F17 | Mission Control Integration | 4h | ★★★☆☆ | SEO access from WhatsApp. Needs MC API wrapper. |
| F18 | Drive Intake Monitor | 4h | ★★★☆☆ | Automation of existing manual workflow. |

### Tier 3: Nice to Have, Future Roadmap
*Estimated total: ~40+ hours*

| # | Feature | Effort | Impact | Justification |
|---|---------|--------|--------|---------------|
| F06 | Smart Invoice Assistant | 16h | ★★★★★ | Highest $ value but complex. Build after F05. |
| F09 | Business Intelligence | 8h | ★★★☆☆ | Strategic value but needs multiple data sources. |
| F12 | Emergency Mode | 4h | ★★★☆☆ | Safety. Extends existing /whereisfrank. |
| F13 | Smart Home / IoT | 8h | ★★☆☆☆ | Nice but not core business. |
| F16 | Rich Media Formatting | 6h | ★★★☆☆ | Better UX but not blocking anything. |
| F19 | Contact Management | 4h | ★★★☆☆ | Useful but lower priority than operational features. |

---

## 7. Architecture Considerations

### 7.1 MCP Server Pattern for New Integrations

Each new integration should follow the established MCP pattern:

```
src/tools/
  cron.js          ← existing
  gateway-mcp.js   ← existing
  weather.js       ← new (F11)
  companycam.js    ← new (F05)
  mission-ctrl.js  ← new (F17)
  contacts.js      ← new (F19)
  routines.js      ← new (F14)
  business-intel.js ← new (F09)
```

Each creates an MCP server via `createSdkMcpServer()` with domain-specific tools. Register in `claude-agent.js` constructor, add tool names to `allowedTools`.

### 7.2 Media Pipeline (F03, F04)

New media handling layer needed in the WhatsApp adapter:

```
src/adapters/whatsapp.js additions:
  sendImage(chatId, buffer, caption)
  sendDocument(chatId, buffer, filename, mimetype)
  sendAudio(chatId, buffer)           // voice notes
  sendVideo(chatId, buffer, caption)
  downloadAudio(msg) -> Buffer
  downloadDocument(msg) -> Buffer
  downloadVideo(msg) -> Buffer
```

Audio processing pipeline for voice messages:
```
Receive: WhatsApp OGG -> download -> Whisper API -> text -> agent
Send:    Agent text -> TTS API -> OGG Opus -> WhatsApp send
```

### 7.3 Proactive Message Architecture

Current cron system already supports proactive messages via `invokeAgent: true`. For new proactive features, extend with:

1. **Event-driven triggers** (beyond time-based crons):
   - New email arrives from VIP sender
   - Google Drive file added to intake folder
   - CompanyCam photo uploaded to active project
   - Weather alert issued for service area

2. **Polling watchers** (check periodically):
   ```
   src/watchers/
     email-watcher.js     — check for urgent emails every 15 min
     drive-watcher.js     — check intake folder every 30 min
     weather-watcher.js   — check severe alerts every 30 min
     task-watcher.js      — check overdue tasks every hour
   ```

3. **Alert deduplication**: Track sent alerts in `workspace/alerts-log.json` with TTL to avoid spamming.

### 7.4 Workflow Routine Engine

```
workspace/routines/
  morning.json
  newjob.json
  closeout.json
  weeklyreview.json
```

Each routine:
```json
{
  "name": "morning",
  "description": "Daily morning briefing",
  "trigger": { "cron": "30 7 * * 1-6" },
  "steps": [
    { "type": "agent", "prompt": "...", "model": "haiku" },
    { "type": "bash", "command": "curl -s wttr.in/Vienna,VA?format=3" },
    { "type": "agent", "prompt": "...", "model": "sonnet" }
  ],
  "output": { "format": "briefing", "target": "self" }
}
```

### 7.5 Model Routing Strategy

```
Intent Classification (rule-based v1):

HAIKU (fast, cheap):
  - Greetings, small talk
  - Single-word commands (/status, /help)
  - Task creation (/todo)
  - Simple lookups ("what time is my next meeting?")
  - Reminders ("remind me in 30 minutes")
  - Yes/no confirmations

SONNET (balanced):
  - Email drafting and replies
  - Calendar management (create/modify events)
  - Multi-tool queries ("check email and calendar")
  - Document search and retrieval
  - CompanyCam lookups
  - File operations

OPUS (deep reasoning):
  - Invoice auditing and scope review
  - Strategic business questions
  - Multi-paragraph analysis
  - Complex research tasks
  - "Compare", "analyze", "audit", "review" keywords
  - Anything touching financial data
```

### 7.6 Security Considerations

- **Team member permissions**: Atlas DM mode already has restricted tool access (defined in system prompt). Extend to per-tool permission matrix.
- **Sensitive data**: Never send financial data to non-Frank chats. Tag sensitive tools.
- **Rate limiting**: Add per-user rate limits for team members (prevent abuse).
- **Audit log**: All outbound messages should be logged for accountability.
- **API key management**: New API keys (Whisper, OpenWeather, CompanyCam) should go in `.env` not in code.

---

## Appendix: Implementation Order (Suggested Sprint Plan)

### Sprint 1 (This Week)
1. F01 — Morning Briefing (2h)
2. F15 — Smart Model Routing (3h)
3. F08 — Quote Replies (3h)
4. F20 — Conversation Summaries (3h)

### Sprint 2 (Next Week)
5. F04 — Document Handling (6h)
6. F02 — Proactive Calendar Alerts (3h)
7. F07 — Follow-Up Nudges (5h)
8. F11 — Weather Integration (4h)

### Sprint 3 (Week 3)
9. F03 — Voice Messages (receive only) (4h)
10. F05 — CompanyCam Integration (8h)
11. F10 — Crew/Team Features (6h)

### Sprint 4+ (Ongoing)
12. F14 — Workflow Routines (6h)
13. F06 — Smart Invoice Assistant (16h)
14. F17 — Mission Control Integration (4h)
15. Remaining Tier 3 features

---

*End of Atlas Feature Roadmap v1.0*
