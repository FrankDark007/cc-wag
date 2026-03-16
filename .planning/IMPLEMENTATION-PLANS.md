# Atlas Feature Implementation Plans — Ultra-Detailed

> Generated: 2026-03-16 | Depth: Maximum
> Each plan includes: exact files to modify, code changes, dependencies, test criteria

---

## Sprint 1: Tier 1 Features (This Week)

---

### PLAN-F01: Morning Briefing

**Goal**: Automated daily WhatsApp message at 7:30 AM with weather, calendar, emails, tasks, and pending items.

#### Files to Create
1. `src/features/morning-briefing.js` — Briefing generator + cron registration

#### Files to Modify
1. `src/gateway.js` — Register briefing on startup
2. `src/commands/handler.js` — Add `/briefing` command
3. `config/system-prompt.md` — Add briefing format instructions

#### Detailed Implementation

**Step 1: Create `src/features/morning-briefing.js`**

```js
import { execSync } from 'child_process'

const GWS = '/opt/homebrew/bin/gws'
const GWS_WORK = '/Users/ghost/Projects/cc-wag/scripts/gws-work.sh'

export default class MorningBriefing {
  constructor(gateway) {
    this.gateway = gateway
    this.cronJobId = null
  }

  /**
   * Register the morning briefing cron job on startup
   * Only creates if not already in cron-jobs.json
   */
  async setup(chatId) {
    const scheduler = this.gateway.agentRunner.agent.cronScheduler
    const existing = scheduler.list().find(j => j.description === 'Morning Briefing')

    if (existing) {
      this.cronJobId = existing.id
      return { alreadySetup: true, jobId: existing.id }
    }

    const result = scheduler.scheduleCron({
      platform: 'whatsapp',
      chatId, // Frank's self-chat JID
      sessionKey: 'cron:morning-briefing',
      message: this.buildBriefingPrompt(),
      cron: '30 7 * * 1-6', // 7:30 AM Mon-Sat
      description: 'Morning Briefing',
      invokeAgent: true
    })

    this.cronJobId = result.jobId
    return result
  }

  /**
   * Run briefing immediately (for /briefing now)
   */
  async runNow() {
    const agent = this.gateway.agentRunner.agent
    const wa = this.gateway.adapters.get('whatsapp')
    if (!wa?.myJid) return { error: 'WhatsApp not connected' }

    const selfJid = wa.myJid.replace(/:.*@/, '@')

    const response = await agent.runAndCollect({
      message: this.buildBriefingPrompt(),
      sessionKey: 'briefing:ondemand',
      platform: 'whatsapp',
      chatId: selfJid,
      mcpServers: this.gateway.mcpServers
    })

    if (response) {
      await wa.sendMessage(selfJid, `🤖 CC: ${response}`)
    }
    return { success: true }
  }

  buildBriefingPrompt() {
    return `Generate my morning briefing. Follow this EXACT structure:

1. WEATHER: Run "curl -s 'wttr.in/Vienna,VA?format=%C+%t+%w+%h'" for current conditions
2. CALENDAR: Run "${GWS} calendar +agenda --days 1" for today's events. List each with time.
3. URGENT EMAIL: Run "${GWS_WORK} gmail +triage --max 5" for recent work emails. Flag anything from insurance companies, adjusters, or clients.
4. TASKS: Run "${GWS} tasks tasks list --tasklist WUlnZzdORlJwa01PTEFVSw" for Flood Doctor tasks. Highlight overdue items.
5. REMINDERS: Check scheduled cron jobs that fire today.

Format as a clean WhatsApp message:
- Use *bold* for section headers
- Keep each section to 2-3 lines max
- Total message under 1000 characters
- End with "Have a great day, boss" or similar brief sign-off
- No markdown except WhatsApp formatting (*bold* _italic_ ~strike~)`
  }

  cancel() {
    if (this.cronJobId) {
      const scheduler = this.gateway.agentRunner.agent.cronScheduler
      return scheduler.cancel(this.cronJobId)
    }
    return { error: 'No briefing scheduled' }
  }
}
```

**Step 2: Add `/briefing` command to `src/commands/handler.js`**

In the `execute()` method switch statement, add:
```js
case 'briefing':
  return this.handleBriefing(args, adapter, chatId)
```

Add method:
```js
async handleBriefing(args, adapter, chatId) {
  const briefing = this.gateway.morningBriefing
  if (!briefing) {
    return { handled: true, response: 'Morning briefing not initialized' }
  }

  if (args === 'now' || args === '') {
    await adapter.sendMessage(chatId, 'Generating briefing...')
    await briefing.runNow()
    return { handled: true }
  }

  if (args === 'setup') {
    const result = await briefing.setup(chatId)
    if (result.alreadySetup) {
      return { handled: true, response: 'Morning briefing already scheduled (7:30 AM Mon-Sat)' }
    }
    return { handled: true, response: `Morning briefing scheduled for 7:30 AM Mon-Sat (job: ${result.jobId})` }
  }

  if (args === 'off' || args === 'cancel') {
    const result = briefing.cancel()
    return { handled: true, response: result.success ? 'Morning briefing cancelled' : result.error }
  }

  return { handled: true, response: 'Usage: /briefing [now|setup|off]' }
}
```

Add to help text:
```
'/briefing - Run morning briefing now',
'/briefing setup - Schedule daily at 7:30 AM',
'/briefing off - Cancel daily briefing',
```

**Step 3: Register in `src/gateway.js`**

After adapter setup in `start()`:
```js
import MorningBriefing from './features/morning-briefing.js'

// In constructor:
this.morningBriefing = new MorningBriefing(this)

// In start(), after WhatsApp connects:
// Auto-setup morning briefing if not already configured
if (whatsapp.myJid) {
  const selfJid = whatsapp.myJid.replace(/:.*@/, '@')
  this.morningBriefing.setup(selfJid)
}
```

**Test Criteria**:
- `/briefing now` sends a formatted briefing within 30 seconds
- `/briefing setup` creates a cron job visible in `/status`
- Briefing covers all 5 sections (weather, calendar, email, tasks, reminders)
- Message is under 1000 characters
- No markdown syntax visible (only WhatsApp formatting)

---

### PLAN-F15: Smart Model Routing

**Goal**: Auto-select Haiku/Sonnet/Opus per message based on complexity.

#### Files to Create
1. `src/agent/model-router.js` — Intent classifier

#### Files to Modify
1. `src/agent/claude-agent.js` — Apply routing before each query
2. `src/config.js` — Add model routing config
3. `config/system-prompt.md` — Note current model in context

#### Detailed Implementation

**Step 1: Create `src/agent/model-router.js`**

```js
/**
 * Rule-based model router for Atlas
 * Classifies message complexity and returns appropriate model
 *
 * Tiers:
 *   haiku  — fast/cheap: greetings, simple lookups, task creation, short messages
 *   sonnet — balanced: email drafting, multi-tool, document ops, moderate complexity
 *   opus   — deep: analysis, auditing, research, long/complex reasoning
 */

// Model IDs from claude-provider.js
const MODELS = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-5-20250929',
  opus: 'claude-opus-4-6'
}

// Patterns that indicate simple tasks (haiku)
const HAIKU_PATTERNS = [
  // Greetings and acknowledgments
  /^(hi|hey|hello|thanks|thank you|ok|okay|cool|got it|yes|no|y|n|sure|yep|nope|good|great|nice|alright|sounds good|perfect|awesome|👍|🙏)$/i,
  // Simple time/date questions
  /^what('?s| is) (the )?(time|date|day)/i,
  /^when (is|does)/i,
  // Task creation
  /^(add|create|make|set) (a )?(task|todo|reminder|timer)/i,
  /^remind me/i,
  /^(todo|task):/i,
  // Status checks
  /^(status|how many|count)/i,
  // Simple lookups
  /^(what|where|who) is [a-z ]{1,30}\??$/i,
  // Weather
  /^(weather|forecast|temperature|rain|hot|cold)/i,
]

// Patterns that indicate complex reasoning (opus)
const OPUS_PATTERNS = [
  // Analysis keywords
  /\b(analyze|audit|evaluate|assess|diagnose|investigate|compare|contrast|review|critique)\b/i,
  // Financial/invoice work
  /\b(invoice|scope|xactimate|line item|billing|estimate|pricing|quote|proposal)\b/i,
  // Strategic thinking
  /\b(strategy|plan|roadmap|architecture|design|propose|recommend|prioritize)\b/i,
  // Research
  /\b(research|find out|look into|deep dive|explore|study)\b/i,
  // Complex instructions
  /\b(explain in detail|break down|walk me through|think through|step by step)\b/i,
  // Multi-paragraph requests
  /\n.*\n/,
]

// Override keywords - user explicitly requests a model
const FORCE_PATTERNS = {
  opus: /\b(use opus|with opus|opus mode|deep think|think hard|ultrathink)\b/i,
  haiku: /\b(use haiku|quick|fast|just|simple)\b/i,
  sonnet: /\b(use sonnet)\b/i,
}

/**
 * Classify a message and return the recommended model
 * @param {string} message - User's message text
 * @param {object} options - Additional context
 * @returns {{ model: string, modelId: string, reason: string }}
 */
export function routeModel(message, options = {}) {
  const text = message.trim()

  // Check for explicit model override first
  for (const [tier, pattern] of Object.entries(FORCE_PATTERNS)) {
    if (pattern.test(text)) {
      return { model: tier, modelId: MODELS[tier], reason: `explicit override: "${tier}"` }
    }
  }

  // Very short messages -> haiku
  if (text.length < 15 && !text.includes('\n')) {
    return { model: 'haiku', modelId: MODELS.haiku, reason: 'very short message' }
  }

  // Check haiku patterns
  for (const pattern of HAIKU_PATTERNS) {
    if (pattern.test(text)) {
      return { model: 'haiku', modelId: MODELS.haiku, reason: 'simple pattern match' }
    }
  }

  // Check opus patterns
  let opusScore = 0
  for (const pattern of OPUS_PATTERNS) {
    if (pattern.test(text)) opusScore++
  }

  // Long messages with multiple opus signals -> opus
  if (opusScore >= 2 || (opusScore >= 1 && text.length > 300)) {
    return { model: 'opus', modelId: MODELS.opus, reason: `complex (score: ${opusScore}, len: ${text.length})` }
  }

  // Has image -> sonnet (good vision, moderate cost)
  if (options.hasImage) {
    return { model: 'sonnet', modelId: MODELS.sonnet, reason: 'image analysis' }
  }

  // Default -> sonnet
  return { model: 'sonnet', modelId: MODELS.sonnet, reason: 'default' }
}

/**
 * Track model usage for cost monitoring
 */
export class ModelUsageTracker {
  constructor() {
    this.usage = { haiku: 0, sonnet: 0, opus: 0 }
  }

  record(model) {
    if (this.usage[model] !== undefined) {
      this.usage[model]++
    }
  }

  getSummary() {
    const total = Object.values(this.usage).reduce((a, b) => a + b, 0)
    return { ...this.usage, total }
  }
}

export default { routeModel, ModelUsageTracker, MODELS }
```

**Step 2: Integrate into `src/agent/claude-agent.js`**

In the `run()` method, before calling `this.provider.query()`:

```js
import { routeModel, ModelUsageTracker } from './model-router.js'

// In constructor:
this.modelUsage = new ModelUsageTracker()
this.autoRouteModel = true // can be toggled via /model auto

// In run() method, before the query:
if (this.autoRouteModel && !this.provider.currentModel) {
  const route = routeModel(message, { hasImage: !!image })
  this.provider.setModel(route.modelId)
  console.log(`[ModelRouter] ${route.model} (${route.reason})`)
  this.modelUsage.record(route.model)
}
```

Important: if user manually set model via `/model`, respect that (check `this.provider.currentModel` is explicitly set vs auto-routed).

**Step 3: Add model info to status output**

In `commands/handler.js handleStatus()`:
```js
const usage = agentRunner.agent.modelUsage.getSummary()
lines.push('')
lines.push(`Model routing: ${agentRunner.agent.autoRouteModel ? 'auto' : 'manual'}`)
lines.push(`Usage: H=${usage.haiku} S=${usage.sonnet} O=${usage.opus} (total ${usage.total})`)
```

**Step 4: `/model auto` toggle**

In handleModel:
```js
if (args === 'auto') {
  agent.autoRouteModel = !agent.autoRouteModel
  return { handled: true, response: `Auto model routing: ${agent.autoRouteModel ? 'ON' : 'OFF'}` }
}
```

**Test Criteria**:
- "hi" → routes to Haiku
- "remind me to call John tomorrow" → routes to Haiku
- "draft an email to StateFarm about the Smith claim" → routes to Sonnet
- "analyze the invoice for the Jones project and compare against Xactimate pricing" → routes to Opus
- "use opus for this: what's the weather" → forces Opus despite simple query
- `/model auto` toggles auto-routing on/off
- `/status` shows model usage counts

---

### PLAN-F08: Quote Replies

**Goal**: Atlas responds to specific messages with WhatsApp quote reply, providing conversation context.

#### Files to Modify
1. `src/adapters/whatsapp.js` — Modify `sendMessage()` to accept quoted message
2. `src/gateway.js` — Pass raw message through pipeline
3. `src/agent/runner.js` — Store and use raw message for quote replies

#### Detailed Implementation

**Step 1: Modify `sendMessage()` in `src/adapters/whatsapp.js`**

```js
// Change signature:
async sendMessage(chatId, text, options = {}) {
  if (!this.sock) {
    throw new Error('WhatsApp not connected')
  }

  let targetJid = this.jidMap?.get(chatId) || chatId
  if (targetJid.endsWith('@lid')) {
    const phoneJid = this.lidToPhone.get(targetJid)
    if (phoneJid) {
      targetJid = phoneJid
      console.log(`[WhatsApp] Resolved LID to phone JID: ${targetJid}`)
    }
  }

  const msgContent = { text }
  const sendOpts = {}

  // Quote reply support
  if (options.quoted) {
    sendOpts.quoted = options.quoted
  }

  const sentMsg = await this.sock.sendMessage(targetJid, msgContent, sendOpts)

  if (sentMsg?.key?.id) {
    this.sentMessageIds.add(sentMsg.key.id)
    setTimeout(() => this.sentMessageIds.delete(sentMsg.key.id), 10000)
  }
}
```

**Step 2: Pass raw message through gateway pipeline**

In `src/gateway.js setupAdapter()`, pass `message.raw` to `enqueueRun`:
```js
const response = await this.agentRunner.enqueueRun(
  sessionKey,
  message.text,
  adapter,
  message.chatId,
  message.image,
  { isAtlas: message.isAtlas || false, rawMessage: message.raw }
)
```

**Step 3: Store rawMessage in runner queue**

In `src/agent/runner.js enqueueRun()`:
```js
const run = {
  // ... existing fields
  rawMessage: meta.rawMessage || null,
  // ...
}
```

In `executeRun()`, when sending responses:
```js
// Change all adapter.sendMessage calls to include quoted:
const sendOpts = run.rawMessage ? { quoted: run.rawMessage } : {}

// Tool called - send accumulated text first
if (chunk.type === 'tool_use' && currentText.trim()) {
  await adapter.sendMessage(chatId, `${prefix} ${currentText.trim()}`, sendOpts)
  currentText = ''
}

// Done - send any remaining text
if (chunk.type === 'done' && currentText.trim()) {
  await adapter.sendMessage(chatId, `${prefix} ${currentText.trim()}`, sendOpts)
}
```

**Test Criteria**:
- Send "CC, what's the weather?" → response appears as quote reply to that message
- Group message mentioning Atlas → response quotes the original message
- Self-chat mode → responses quote the triggering message
- Cron-triggered messages → sent without quote (rawMessage is null)

---

### PLAN-F20: Conversation Summaries

**Goal**: Auto-summarize conversations on `/new`, add `/summary` command, extract action items to Google Tasks.

#### Files to Modify
1. `src/commands/handler.js` — Modify handleReset, add handleSummary
2. `config/system-prompt.md` — Add commitment detection instructions

#### Detailed Implementation

**Step 1: Modify `handleReset()` to summarize before clearing**

```js
async handleReset(sessionKey, adapter, chatId) {
  const sessionManager = this.gateway.sessionManager
  const agentRunner = this.gateway.agentRunner

  // Check if there's meaningful conversation to summarize
  const session = agentRunner.agent.sessions.get(sessionKey)
  const messageCount = session?.messageCount || 0

  if (messageCount >= 3) {
    // Generate summary before resetting
    try {
      await adapter.sendMessage(chatId, 'Summarizing conversation...')

      const summary = await agentRunner.agent.runAndCollect({
        message: `Summarize our conversation. Output exactly this format:

TOPICS: [comma-separated list of topics discussed]
DECISIONS: [any decisions made, or "none"]
ACTION ITEMS: [any tasks/commitments identified, or "none"]
KEY INFO: [any important facts worth remembering]

Be concise. No headers or formatting beyond what I specified.`,
        sessionKey: sessionKey + ':summary',
        platform: 'whatsapp',
        chatId,
        mcpServers: this.gateway.mcpServers
      })

      if (summary) {
        // Save to daily memory
        agentRunner.agent.memoryManager.appendToDailyMemory(
          `### Session Summary\n${summary}`
        )

        // Notify user
        await adapter.sendMessage(chatId, `Summary saved to memory.`)
      }
    } catch (err) {
      console.error('[Summary] Failed:', err.message)
      // Don't block reset on summary failure
    }
  }

  // Existing reset logic
  if (agentRunner.agent.sessions.has(sessionKey)) {
    agentRunner.agent.sessions.delete(sessionKey)
  }

  if (sessionManager.sessions.has(sessionKey)) {
    sessionManager.sessions.delete(sessionKey)
  }

  // Deactivate self-chat session
  const wa = this.gateway.adapters.get('whatsapp')
  if (wa) {
    wa.deactivateSelfChat(chatId)
    wa.deactivateTeamSession(chatId)
  }

  return {
    handled: true,
    response: 'Session reset. Starting fresh.'
  }
}
```

**Step 2: Add `/summary` command**

```js
case 'summary':
  return this.handleSummary(sessionKey, adapter, chatId)
```

```js
async handleSummary(sessionKey, adapter, chatId) {
  const agentRunner = this.gateway.agentRunner
  const session = agentRunner.agent.sessions.get(sessionKey)

  if (!session || session.messageCount < 2) {
    return { handled: true, response: 'Not enough conversation to summarize.' }
  }

  await adapter.sendMessage(chatId, 'Generating summary...')

  try {
    const summary = await agentRunner.agent.runAndCollect({
      message: `Summarize our conversation so far. Keep it concise and mobile-friendly. List topics, decisions, and any pending action items.`,
      sessionKey,
      platform: 'whatsapp',
      chatId,
      mcpServers: this.gateway.mcpServers
    })

    if (summary) {
      return { handled: true, response: `🤖 CC:\n${summary}` }
    }
    return { handled: true, response: 'Could not generate summary.' }
  } catch (err) {
    return { handled: true, response: `Summary failed: ${err.message}` }
  }
}
```

**Step 3: Add commitment detection to system prompt**

Add to `config/system-prompt.md`:
```
## Commitment Detection
When Frank makes a commitment or states an intention to do something (e.g., "I'll send that over", "I need to call them", "remind me to...", "don't let me forget to...", "I should follow up with..."), PROACTIVELY create a Google Task:
- Use the FloodDoctor task list by default
- Set due date to tomorrow at 9am if not specified
- Title format: "Follow up: [action]" or "Call: [person]" or "Send: [document]"
- Confirm to Frank: "Added to your tasks: [title]"
```

**Step 4: Add help text**

```
'/summary - Summarize current conversation',
```

**Test Criteria**:
- Have 5+ message conversation, run `/summary` → get concise recap
- Run `/new` after conversation → summary saved to daily memory
- Say "I need to call the adjuster about Smith" → auto-creates Google Task
- `/new` with <3 messages → skips summary, resets immediately
- Summary failure doesn't block session reset

---

### PLAN-F07: Follow-Up Nudges & Task Deadline Alerts

**Goal**: Proactive reminders about overdue Google Tasks and missed commitments.

#### Files to Create
1. `src/features/task-nudger.js` — Overdue task checker

#### Files to Modify
1. `src/gateway.js` — Register nudger on startup
2. `config/system-prompt.md` — Commitment detection (shared with F20)

#### Detailed Implementation

**Step 1: Create `src/features/task-nudger.js`**

```js
import { execSync } from 'child_process'

const GWS = '/opt/homebrew/bin/gws'
const TASK_LISTS = {
  floodDoctor: 'WUlnZzdORlJwa01PTEFVSw',
  personal: 'NE1SZ0pXUF9hT2pVczFUQg'
}

export default class TaskNudger {
  constructor(gateway) {
    this.gateway = gateway
    this.cronJobId = null
    this.lastNudge = null // track to avoid spam
  }

  /**
   * Set up daily overdue task check at 9:00 AM and 4:00 PM
   */
  setup(chatId) {
    const scheduler = this.gateway.agentRunner.agent.cronScheduler

    // Morning overdue check
    const existing = scheduler.list().find(j => j.description === 'Task Nudger')
    if (existing) return { alreadySetup: true }

    const result = scheduler.scheduleCron({
      platform: 'whatsapp',
      chatId,
      sessionKey: 'cron:task-nudger',
      message: this.buildNudgePrompt(),
      cron: '0 9 * * 1-5', // 9 AM weekdays
      description: 'Task Nudger',
      invokeAgent: true
    })

    // Also afternoon check
    scheduler.scheduleCron({
      platform: 'whatsapp',
      chatId,
      sessionKey: 'cron:task-nudger-pm',
      message: this.buildAfternoonPrompt(),
      cron: '0 16 * * 1-5', // 4 PM weekdays
      description: 'Task Nudger (PM)',
      invokeAgent: true
    })

    this.cronJobId = result.jobId
    return result
  }

  buildNudgePrompt() {
    return `Check for overdue tasks. Run these commands:
1. gws tasks tasks list --tasklist WUlnZzdORlJwa01PTEFVSw (FloodDoctor tasks)
2. gws tasks tasks list --tasklist NE1SZ0pXUF9hT2pVczFUQg (Personal tasks)

Look for tasks that are past their due date. If you find any:
- List them with how many days overdue
- Use *bold* for the task name
- Keep it brief — just the overdue items
- Format: "*Task Name* — X days overdue"
- End with total count

If NO tasks are overdue, respond with just: "All clear — no overdue tasks"

Use haiku-level brevity.`
  }

  buildAfternoonPrompt() {
    return `Quick afternoon check — look at tasks due TODAY that haven't been completed:
1. gws tasks tasks list --tasklist WUlnZzdORlJwa01PTEFVSw
2. gws tasks tasks list --tasklist NE1SZ0pXUF9hT2pVczFUQg

If any tasks are due today and still open, list them.
If all clear, say nothing (return empty response).`
  }
}
```

**Step 2: Register in gateway.js**

```js
import TaskNudger from './features/task-nudger.js'

// In constructor:
this.taskNudger = new TaskNudger(this)

// In start(), after WhatsApp connects:
if (whatsapp.myJid) {
  const selfJid = whatsapp.myJid.replace(/:.*@/, '@')
  this.taskNudger.setup(selfJid)
}
```

**Test Criteria**:
- Cron jobs created on startup (visible in /queue or cron list)
- At 9 AM, if overdue tasks exist → receives WhatsApp message listing them
- If no overdue tasks → "All clear" message
- Afternoon check only fires if due-today tasks remain open

---

### PLAN-F02: Proactive Calendar Alerts

**Goal**: Alert 30 minutes before calendar events.

#### Files to Create
1. `src/features/calendar-alerts.js` — Calendar polling watcher

#### Files to Modify
1. `src/gateway.js` — Register watcher on startup

#### Detailed Implementation

**Step 1: Create `src/features/calendar-alerts.js`**

```js
import { execSync } from 'child_process'
import fs from 'fs'

const GWS = '/opt/homebrew/bin/gws'
const ALERTS_FILE = '/Users/ghost/Projects/cc-wag/workspace/sent-alerts.json'

export default class CalendarAlerts {
  constructor(gateway) {
    this.gateway = gateway
    this.sentAlerts = this.loadSentAlerts()
    this.interval = null
    this.selfChatJid = null
  }

  loadSentAlerts() {
    try {
      if (fs.existsSync(ALERTS_FILE)) {
        return new Map(Object.entries(JSON.parse(fs.readFileSync(ALERTS_FILE, 'utf-8'))))
      }
    } catch {}
    return new Map()
  }

  saveSentAlerts() {
    try {
      const obj = Object.fromEntries(this.sentAlerts)
      fs.writeFileSync(ALERTS_FILE, JSON.stringify(obj, null, 2))
    } catch (err) {
      console.error('[CalendarAlerts] Failed to save:', err.message)
    }
  }

  start(selfChatJid) {
    this.selfChatJid = selfChatJid
    // Check every 10 minutes
    this.interval = setInterval(() => this.check(), 10 * 60 * 1000)
    // First check after 30 seconds (let gateway finish init)
    setTimeout(() => this.check(), 30000)
    console.log('[CalendarAlerts] Started — checking every 10 minutes')
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
  }

  async check() {
    if (!this.selfChatJid) return

    try {
      // Get today's agenda
      const output = execSync(`${GWS} calendar +agenda --days 1`, {
        encoding: 'utf-8',
        timeout: 15000
      })

      const now = new Date()
      const events = this.parseAgenda(output)

      for (const event of events) {
        if (!event.start) continue

        const minutesUntil = (event.start - now) / 60000
        const alertKey = `${event.start.toISOString()}-${event.summary}`

        // Alert window: 25-35 minutes before (catches 10-min polling window)
        if (minutesUntil > 0 && minutesUntil <= 35 && !this.sentAlerts.has(alertKey)) {
          this.sentAlerts.set(alertKey, Date.now())
          this.saveSentAlerts()

          const mins = Math.round(minutesUntil)
          const timeStr = event.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

          let msg = `📅 *Reminder*: ${event.summary}\nTime: ${timeStr} (${mins} min from now)`
          if (event.location) {
            msg += `\nLocation: ${event.location}`
          }

          const wa = this.gateway.adapters.get('whatsapp')
          if (wa) {
            await wa.sendMessage(this.selfChatJid, msg)
            console.log(`[CalendarAlerts] Sent alert: ${event.summary} in ${mins}min`)
          }
        }
      }

      // Cleanup old alerts (>24 hours)
      const dayAgo = Date.now() - 24 * 60 * 60 * 1000
      for (const [key, ts] of this.sentAlerts) {
        if (ts < dayAgo) this.sentAlerts.delete(key)
      }
    } catch (err) {
      // Silently fail — don't spam logs on calendar check errors
      if (!err.message.includes('timeout')) {
        console.error('[CalendarAlerts] Check failed:', err.message)
      }
    }
  }

  /**
   * Parse gws calendar +agenda output into event objects
   * Format varies but typically:
   *   Mar 17, 2026  2:00 PM - 3:00 PM  Meeting Name
   *   or similar date-time-summary patterns
   */
  parseAgenda(output) {
    const events = []
    const lines = output.split('\n').filter(l => l.trim())

    for (const line of lines) {
      // Try to extract time pattern: HH:MM AM/PM or similar
      const timeMatch = line.match(/(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm))/i)
      const dateMatch = line.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s*\d{4})/i)

      if (timeMatch) {
        try {
          const dateStr = dateMatch ? dateMatch[1] : new Date().toDateString()
          const start = new Date(`${dateStr} ${timeMatch[1]}`)

          // Extract summary (everything after the time range)
          const afterTime = line.replace(/.*\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)\s*(?:-\s*\d{1,2}:\d{2}\s*(?:AM|PM|am|pm))?\s*/i, '').trim()

          if (!isNaN(start.getTime())) {
            events.push({
              summary: afterTime || 'Untitled Event',
              start,
              location: null // Would need additional parsing
            })
          }
        } catch {}
      }
    }

    return events
  }
}
```

**Step 2: Register in gateway.js**

```js
import CalendarAlerts from './features/calendar-alerts.js'

// In constructor:
this.calendarAlerts = new CalendarAlerts(this)

// In start(), after WhatsApp connects successfully:
if (whatsapp.myJid) {
  const selfJid = whatsapp.myJid.replace(/:.*@/, '@')
  this.calendarAlerts.start(selfJid)
}

// In stop():
this.calendarAlerts.stop()
```

**Test Criteria**:
- Create a calendar event 30 minutes from now → receive WhatsApp alert
- Same event → only one alert (no duplicates)
- Alert includes event name, time, and minutes until
- No alert for events >35 min away
- No alert for past events
- Gateway shutdown cleans up interval

---

## Sprint 2: Tier 1 Continued + Tier 2 Start

---

### PLAN-F04: Document Handling

**Goal**: Send/receive documents (PDF, images, Word) via WhatsApp. Enable "send me the X file" workflow.

#### Files to Modify
1. `src/adapters/whatsapp.js` — Add media send methods + document receive handling
2. `src/tools/gateway-mcp.js` — Add send_image, send_document, send_drive_file tools
3. `src/agent/claude-agent.js` — Add new gateway tools to allowed list

#### Detailed Implementation

**Step 1: Add media methods to WhatsApp adapter**

```js
// In whatsapp.js, add these methods:

async sendImage(chatId, buffer, caption = '') {
  if (!this.sock) throw new Error('WhatsApp not connected')

  let targetJid = this.jidMap?.get(chatId) || chatId
  if (targetJid.endsWith('@lid')) {
    const phoneJid = this.lidToPhone.get(targetJid)
    if (phoneJid) targetJid = phoneJid
  }

  const msg = { image: buffer }
  if (caption) msg.caption = caption

  const sentMsg = await this.sock.sendMessage(targetJid, msg)
  if (sentMsg?.key?.id) {
    this.sentMessageIds.add(sentMsg.key.id)
    setTimeout(() => this.sentMessageIds.delete(sentMsg.key.id), 10000)
  }
}

async sendDocument(chatId, buffer, fileName, mimetype = 'application/octet-stream') {
  if (!this.sock) throw new Error('WhatsApp not connected')

  let targetJid = this.jidMap?.get(chatId) || chatId
  if (targetJid.endsWith('@lid')) {
    const phoneJid = this.lidToPhone.get(targetJid)
    if (phoneJid) targetJid = phoneJid
  }

  const sentMsg = await this.sock.sendMessage(targetJid, {
    document: buffer,
    mimetype,
    fileName
  })

  if (sentMsg?.key?.id) {
    this.sentMessageIds.add(sentMsg.key.id)
    setTimeout(() => this.sentMessageIds.delete(sentMsg.key.id), 10000)
  }
}

async sendAudio(chatId, buffer, ptt = true) {
  if (!this.sock) throw new Error('WhatsApp not connected')

  let targetJid = this.jidMap?.get(chatId) || chatId
  if (targetJid.endsWith('@lid')) {
    const phoneJid = this.lidToPhone.get(targetJid)
    if (phoneJid) targetJid = phoneJid
  }

  const sentMsg = await this.sock.sendMessage(targetJid, {
    audio: buffer,
    mimetype: 'audio/ogg; codecs=opus',
    ptt
  })

  if (sentMsg?.key?.id) {
    this.sentMessageIds.add(sentMsg.key.id)
    setTimeout(() => this.sentMessageIds.delete(sentMsg.key.id), 10000)
  }
}

async downloadDocument(msg) {
  try {
    const buffer = await downloadMediaMessage(
      msg, 'buffer', {},
      { logger: pino({ level: 'silent' }), reuploadRequest: this.sock.updateMediaMessage }
    )
    return buffer
  } catch (err) {
    console.error('[WhatsApp] Failed to download document:', err.message)
    return null
  }
}

async downloadAudio(msg) {
  try {
    const buffer = await downloadMediaMessage(
      msg, 'buffer', {},
      { logger: pino({ level: 'silent' }), reuploadRequest: this.sock.updateMediaMessage }
    )
    return buffer
  } catch (err) {
    console.error('[WhatsApp] Failed to download audio:', err.message)
    return null
  }
}
```

**Step 2: Handle document and audio messages in `handleMessage()`**

Add to the existing message handling section (after image handling):

```js
// Check for document
let document = null
if (msg.message?.documentMessage) {
  console.log('[WhatsApp] Downloading document...')
  const docMsg = msg.message.documentMessage
  const buffer = await this.downloadDocument(msg)
  if (buffer) {
    document = {
      data: buffer.toString('base64'),
      fileName: docMsg.fileName || 'document',
      mimetype: docMsg.mimetype || 'application/octet-stream',
      size: buffer.length
    }
    console.log(`[WhatsApp] Document: ${document.fileName} (${buffer.length} bytes)`)
  }
  if (!text) text = `[Document: ${docMsg.fileName || 'unnamed'}]`
}

// Check for audio/voice note
let audio = null
if (msg.message?.audioMessage) {
  console.log('[WhatsApp] Downloading audio...')
  const audioMsg = msg.message.audioMessage
  const buffer = await this.downloadAudio(msg)
  if (buffer) {
    audio = {
      data: buffer.toString('base64'),
      duration: audioMsg.seconds || 0,
      ptt: audioMsg.ptt || false, // true = voice note, false = audio file
      mimetype: audioMsg.mimetype || 'audio/ogg',
      size: buffer.length
    }
    console.log(`[WhatsApp] Audio: ${audio.duration}s, ptt=${audio.ptt}, ${buffer.length} bytes`)
  }
  if (!text) text = `[Voice Note: ${audioMsg.seconds || '?'}s]`
}
```

Update `emitMessage` to include new media:
```js
this.emitMessage({
  chatId: jid,
  text,
  isGroup,
  isAtlas: this.activeTeamSessions.has(jid),
  sender,
  mentions: isMentioned ? ['self'] : mentions,
  image,
  document,
  audio,
  raw: msg
})
```

**Step 3: Add MCP tools to `src/tools/gateway-mcp.js`**

```js
import fs from 'fs'
import path from 'path'

// Mime type helper
function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase()
  const types = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.html': 'text/html',
  }
  return types[ext] || 'application/octet-stream'
}

// Add these tools to the tools array in createGatewayMcpServer:

tool(
  'send_image',
  'Send an image file via WhatsApp. Provide the absolute path to an image file on disk.',
  {
    chat_id: z.string().describe('WhatsApp chat ID to send to'),
    file_path: z.string().describe('Absolute path to the image file'),
    caption: z.string().optional().describe('Caption text for the image')
  },
  async ({ chat_id, file_path, caption }) => {
    const { gateway } = gatewayContext
    if (!gateway) return error('Gateway not available')

    const adapter = gateway.adapters.get('whatsapp')
    if (!adapter) return error('WhatsApp not connected')

    try {
      const buffer = fs.readFileSync(file_path)
      await adapter.sendImage(chat_id, buffer, caption || '')
      return success({ sent: true, file: path.basename(file_path), size: buffer.length })
    } catch (err) {
      return error(err.message)
    }
  }
),

tool(
  'send_document',
  'Send a document/file via WhatsApp (PDF, Word, Excel, etc). Provide absolute path.',
  {
    chat_id: z.string().describe('WhatsApp chat ID to send to'),
    file_path: z.string().describe('Absolute path to the document file'),
    filename: z.string().optional().describe('Display filename (defaults to actual filename)')
  },
  async ({ chat_id, file_path, filename }) => {
    const { gateway } = gatewayContext
    if (!gateway) return error('Gateway not available')

    const adapter = gateway.adapters.get('whatsapp')
    if (!adapter) return error('WhatsApp not connected')

    try {
      const buffer = fs.readFileSync(file_path)
      const name = filename || path.basename(file_path)
      const mimetype = getMimeType(name)
      await adapter.sendDocument(chat_id, buffer, name, mimetype)
      return success({ sent: true, file: name, mimetype, size: buffer.length })
    } catch (err) {
      return error(err.message)
    }
  }
),

tool(
  'send_drive_file',
  'Download a file from Google Drive and send it via WhatsApp. Search by name or provide file ID.',
  {
    chat_id: z.string().describe('WhatsApp chat ID to send to'),
    query: z.string().describe('Search query for Google Drive (e.g., "Smith invoice" or file ID)'),
    caption: z.string().optional().describe('Caption or message to send with the file')
  },
  async ({ chat_id, query, caption }) => {
    const { gateway } = gatewayContext
    if (!gateway) return error('Gateway not available')

    const adapter = gateway.adapters.get('whatsapp')
    if (!adapter) return error('WhatsApp not connected')

    try {
      const { execSync } = await import('child_process')

      // Search for file
      const searchOutput = execSync(
        `/opt/homebrew/bin/gws drive files list --q "name contains '${query.replace(/'/g, "\\'")}'\" --fields "files(id,name,mimeType)" --json`,
        { encoding: 'utf-8', timeout: 15000 }
      )

      const files = JSON.parse(searchOutput)
      if (!files.files?.length) {
        return error(`No files found matching "${query}"`)
      }

      const file = files.files[0]

      // Download to temp location
      const tmpPath = `/tmp/atlas-drive-${Date.now()}-${file.name}`
      execSync(
        `/opt/homebrew/bin/gws drive files get --fileId "${file.id}" --out "${tmpPath}"`,
        { encoding: 'utf-8', timeout: 30000 }
      )

      // Send via WhatsApp
      const buffer = fs.readFileSync(tmpPath)
      const mimetype = getMimeType(file.name)

      if (mimetype.startsWith('image/')) {
        await adapter.sendImage(chat_id, buffer, caption || file.name)
      } else {
        await adapter.sendDocument(chat_id, buffer, file.name, mimetype)
      }

      // Cleanup temp file
      fs.unlinkSync(tmpPath)

      return success({ sent: true, file: file.name, mimetype, size: buffer.length })
    } catch (err) {
      return error(err.message)
    }
  }
)
```

Add helper functions at top of file:
```js
function success(data) {
  return { content: [{ type: 'text', text: JSON.stringify({ success: true, ...data }) }] }
}
function error(message) {
  return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: message }) }] }
}
```

**Step 4: Register new tools in claude-agent.js**

```js
this.gatewayTools = [
  // ... existing tools
  'mcp__gateway__send_image',
  'mcp__gateway__send_document',
  'mcp__gateway__send_drive_file'
]
```

**Test Criteria**:
- "Send me the Smith invoice from Drive" → searches Drive, downloads, sends as document
- "Send this photo to the crew group" (with file path) → sends image
- Receive a PDF → agent can describe it / extract text
- Receive a voice note → handled as audio message
- Send document with correct filename and mimetype
- Google Drive search finds the right file

---

### PLAN-F03: Voice Message Support (Receive Only — Sprint 2)

**Goal**: Receive WhatsApp voice notes, transcribe to text, process as regular message.

#### Files to Create
1. `src/features/voice-transcriber.js` — Audio transcription via Whisper API

#### Files to Modify
1. `src/adapters/whatsapp.js` — Handle audio messages (from F04)
2. `src/gateway.js` — Transcribe before passing to agent
3. `src/config.js` — Add Whisper API config

#### Detailed Implementation

**Step 1: Create `src/features/voice-transcriber.js`**

```js
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

const WORKSPACE = '/Users/ghost/Projects/cc-wag/workspace'

/**
 * Voice transcription using OpenAI Whisper API
 * Falls back to local whisper.cpp if API key not available
 */
export default class VoiceTranscriber {
  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY || ''
    this.tmpDir = path.join(WORKSPACE, 'tmp')
    this.ensureDir()
  }

  ensureDir() {
    if (!fs.existsSync(this.tmpDir)) {
      fs.mkdirSync(this.tmpDir, { recursive: true })
    }
  }

  /**
   * Transcribe audio buffer to text
   * @param {Buffer} buffer - Audio data (OGG/Opus from WhatsApp)
   * @param {string} mimetype - Audio mime type
   * @returns {Promise<string>} Transcribed text
   */
  async transcribe(buffer, mimetype = 'audio/ogg') {
    if (this.apiKey) {
      return this.transcribeWithWhisperAPI(buffer, mimetype)
    }
    return this.transcribeWithLocal(buffer, mimetype)
  }

  /**
   * Transcribe using OpenAI Whisper API
   */
  async transcribeWithWhisperAPI(buffer, mimetype) {
    const tmpFile = path.join(this.tmpDir, `voice-${Date.now()}.ogg`)

    try {
      fs.writeFileSync(tmpFile, buffer)

      // Use curl to call Whisper API (avoids adding openai npm dep)
      const output = execSync(
        `curl -s -X POST https://api.openai.com/v1/audio/transcriptions ` +
        `-H "Authorization: Bearer ${this.apiKey}" ` +
        `-F "file=@${tmpFile}" ` +
        `-F "model=whisper-1" ` +
        `-F "response_format=text"`,
        { encoding: 'utf-8', timeout: 30000 }
      )

      return output.trim()
    } catch (err) {
      console.error('[VoiceTranscriber] Whisper API failed:', err.message)
      throw err
    } finally {
      // Cleanup
      try { fs.unlinkSync(tmpFile) } catch {}
    }
  }

  /**
   * Fallback: transcribe using local whisper (whisper.cpp or similar)
   */
  async transcribeWithLocal(buffer, mimetype) {
    const tmpOgg = path.join(this.tmpDir, `voice-${Date.now()}.ogg`)
    const tmpWav = path.join(this.tmpDir, `voice-${Date.now()}.wav`)

    try {
      fs.writeFileSync(tmpOgg, buffer)

      // Convert OGG to WAV using ffmpeg
      execSync(`ffmpeg -i "${tmpOgg}" -ar 16000 -ac 1 "${tmpWav}" -y 2>/dev/null`, { timeout: 15000 })

      // Try whisper.cpp
      const output = execSync(`whisper "${tmpWav}" --model base --output_format txt 2>/dev/null`, {
        encoding: 'utf-8',
        timeout: 60000
      })

      return output.trim()
    } catch (err) {
      console.error('[VoiceTranscriber] Local transcription failed:', err.message)
      return '[Voice note received but transcription failed. Please type your message instead.]'
    } finally {
      try { fs.unlinkSync(tmpOgg) } catch {}
      try { fs.unlinkSync(tmpWav) } catch {}
    }
  }
}
```

**Step 2: Integrate into gateway message pipeline**

In `src/gateway.js setupAdapter()`, before enqueueRun, handle audio:

```js
import VoiceTranscriber from './features/voice-transcriber.js'

// In constructor:
this.voiceTranscriber = new VoiceTranscriber()

// In setupAdapter onMessage callback, before enqueueRun:
// Transcribe voice notes
if (message.audio && message.audio.ptt) {
  console.log(`[${platform.toUpperCase()}] Transcribing voice note (${message.audio.duration}s)...`)
  try {
    const audioBuffer = Buffer.from(message.audio.data, 'base64')
    const transcription = await this.voiceTranscriber.transcribe(audioBuffer, message.audio.mimetype)

    if (transcription && transcription.length > 0) {
      // Replace text with transcription
      message.text = `[Voice Note]: ${transcription}`
      console.log(`[${platform.toUpperCase()}] Transcribed: "${transcription.substring(0, 100)}"`)
    }
  } catch (err) {
    console.error(`[${platform.toUpperCase()}] Transcription failed:`, err.message)
    message.text = '[Voice note received but could not be transcribed]'
  }
}
```

**Step 3: Add config**

In `.env`:
```
OPENAI_API_KEY=sk-...  # For Whisper transcription
```

In `src/config.js`:
```js
voice: {
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  maxDurationSeconds: 120, // reject voice notes longer than 2 min
}
```

**Test Criteria**:
- Send voice note via WhatsApp → Atlas responds to transcribed text
- Short voice note (5s) → transcription in <5 seconds
- Whisper API failure → graceful fallback message
- Voice note content is logged in transcript
- No temp files left behind after processing

---

### PLAN-F11: Weather Integration

**Goal**: Weather info on demand + severe weather alerts for Northern Virginia.

#### Files to Create
1. `src/features/weather.js` — Weather fetcher + severe alert monitor

#### Files to Modify
1. `src/tools/gateway-mcp.js` — Add weather MCP tool (or standalone weather MCP)
2. `src/agent/claude-agent.js` — Add weather tools to allowed list
3. `src/gateway.js` — Register severe weather watcher

#### Detailed Implementation

**Step 1: Create `src/features/weather.js`**

```js
import { execSync } from 'child_process'
import fs from 'fs'

const ALERTS_FILE = '/Users/ghost/Projects/cc-wag/workspace/weather-alerts-seen.json'
const DEFAULT_LOCATION = 'Vienna,VA'
const NWS_ZONE = 'VAZ053' // Fairfax County

export default class WeatherService {
  constructor(gateway) {
    this.gateway = gateway
    this.seenAlerts = this.loadSeenAlerts()
    this.interval = null
    this.selfChatJid = null
  }

  loadSeenAlerts() {
    try {
      if (fs.existsSync(ALERTS_FILE)) {
        return new Set(JSON.parse(fs.readFileSync(ALERTS_FILE, 'utf-8')))
      }
    } catch {}
    return new Set()
  }

  saveSeenAlerts() {
    try {
      fs.writeFileSync(ALERTS_FILE, JSON.stringify([...this.seenAlerts]))
    } catch {}
  }

  /**
   * Get current weather using wttr.in (no API key needed)
   */
  getCurrentWeather(location = DEFAULT_LOCATION) {
    try {
      const current = execSync(
        `curl -s "wttr.in/${encodeURIComponent(location)}?format=%C+%t+%w+%h+%p"`,
        { encoding: 'utf-8', timeout: 10000 }
      ).trim()

      const forecast = execSync(
        `curl -s "wttr.in/${encodeURIComponent(location)}?format=3"`,
        { encoding: 'utf-8', timeout: 10000 }
      ).trim()

      return { current, forecast, location }
    } catch (err) {
      return { error: err.message }
    }
  }

  /**
   * Get NWS severe weather alerts for the service area
   * Uses the free NWS API (api.weather.gov)
   */
  async checkSevereAlerts() {
    try {
      const output = execSync(
        `curl -s -H "User-Agent: Atlas-WhatsApp/1.0" "https://api.weather.gov/alerts/active?zone=${NWS_ZONE}"`,
        { encoding: 'utf-8', timeout: 15000 }
      )

      const data = JSON.parse(output)
      const alerts = (data.features || []).map(f => ({
        id: f.properties.id,
        event: f.properties.event,
        severity: f.properties.severity, // Extreme, Severe, Moderate, Minor
        headline: f.properties.headline,
        description: f.properties.description?.substring(0, 500),
        expires: f.properties.expires
      }))

      return alerts.filter(a => ['Extreme', 'Severe'].includes(a.severity))
    } catch (err) {
      console.error('[Weather] NWS check failed:', err.message)
      return []
    }
  }

  /**
   * Start severe weather monitoring (every 30 min)
   */
  startAlertMonitor(selfChatJid) {
    this.selfChatJid = selfChatJid
    this.interval = setInterval(() => this.monitorAlerts(), 30 * 60 * 1000)
    // First check after 1 minute
    setTimeout(() => this.monitorAlerts(), 60000)
    console.log('[Weather] Severe weather monitoring started (every 30 min)')
  }

  async monitorAlerts() {
    if (!this.selfChatJid) return

    const alerts = await this.checkSevereAlerts()

    for (const alert of alerts) {
      if (this.seenAlerts.has(alert.id)) continue

      this.seenAlerts.add(alert.id)
      this.saveSeenAlerts()

      // Send alert via WhatsApp
      const msg = `⚠️ *WEATHER ALERT*\n\n${alert.headline}\n\nSeverity: ${alert.severity}\nExpires: ${new Date(alert.expires).toLocaleString()}\n\n${alert.description || ''}`

      const wa = this.gateway.adapters.get('whatsapp')
      if (wa) {
        await wa.sendMessage(this.selfChatJid, msg)
        console.log(`[Weather] Alert sent: ${alert.event}`)
      }
    }
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
  }
}
```

**Step 2: The agent can already get weather via bash**

Since the agent has Bash access, it can run `curl wttr.in/...` directly. The main value-add is the severe weather monitoring, which is the proactive component.

Add to system prompt:
```
## Weather
For weather questions, run: curl -s "wttr.in/Vienna,VA?format=%C+%t+%w+%h"
For forecast: curl -s "wttr.in/Vienna,VA?format=3"
The system automatically monitors for severe weather alerts in Northern Virginia.
```

**Step 3: Register in gateway.js**

```js
import WeatherService from './features/weather.js'

// In constructor:
this.weather = new WeatherService(this)

// In start() after WhatsApp connects:
if (whatsapp.myJid) {
  const selfJid = whatsapp.myJid.replace(/:.*@/, '@')
  this.weather.startAlertMonitor(selfJid)
}

// In stop():
this.weather.stop()
```

**Test Criteria**:
- "What's the weather?" → agent runs curl and provides weather
- Severe weather alert in Fairfax County → WhatsApp message within 30 min
- Same alert → not sent twice
- No API key required (uses free wttr.in + NWS API)

---

### PLAN-F14: Workflow Routines (Sprint 3)

**Goal**: Named multi-step workflows triggered by `/routine <name>`.

#### Files to Create
1. `src/features/routines.js` — Routine engine
2. `workspace/routines/morning.json` — Morning routine definition
3. `workspace/routines/newjob.json` — New job routine
4. `workspace/routines/closeout.json` — Job closeout routine

#### Files to Modify
1. `src/commands/handler.js` — Add `/routine` command
2. `src/gateway.js` — Register routine engine

#### Implementation Notes (Sprint 3)

Routine definitions stored as JSON in `workspace/routines/`:

```json
{
  "name": "newjob",
  "description": "Set up a new restoration job",
  "args": ["client_name", "address"],
  "steps": [
    {
      "type": "agent",
      "prompt": "Create a Google Task in FloodDoctor list: 'New Job: {{client_name}} at {{address}}'",
      "model": "haiku"
    },
    {
      "type": "agent",
      "prompt": "Create a Google Calendar event for initial inspection at {{address}} for {{client_name}} tomorrow at 10am",
      "model": "haiku"
    },
    {
      "type": "agent",
      "prompt": "Search Google Drive for any existing files related to '{{client_name}}' or '{{address}}'",
      "model": "sonnet"
    }
  ],
  "summary": "New job setup for {{client_name}}"
}
```

Command: `/routine newjob "John Smith" "123 Main St, Arlington, VA"`

Parses args, substitutes `{{variables}}`, executes steps sequentially, collects results, sends summary.

---

## Cross-Cutting Concerns

### Error Handling Pattern
All new features should follow:
```js
try {
  // Feature logic
} catch (err) {
  console.error(`[FeatureName] Error:`, err.message)
  // Don't crash gateway — log and continue
  // Send error message to user if in interactive context
}
```

### Feature Toggle Pattern
All features should be disable-able via .env:
```
FEATURE_MORNING_BRIEFING=true
FEATURE_CALENDAR_ALERTS=true
FEATURE_WEATHER_ALERTS=true
FEATURE_SMART_ROUTING=true
FEATURE_VOICE_TRANSCRIPTION=true
```

### File Organization
```
src/
  features/           ← NEW directory
    morning-briefing.js
    calendar-alerts.js
    task-nudger.js
    voice-transcriber.js
    weather.js
    routines.js
  agent/
    model-router.js    ← NEW
    claude-agent.js    ← modified
    runner.js          ← modified
  adapters/
    whatsapp.js        ← modified (media methods)
  tools/
    gateway-mcp.js     ← modified (new tools)
  commands/
    handler.js         ← modified (new commands)
```

---

## Dependency Graph

```
F15 (Model Routing)     → standalone, no deps
F08 (Quote Replies)     → standalone, no deps
F20 (Summaries)         → standalone, no deps
F01 (Morning Briefing)  → standalone (uses existing cron + gws)
F07 (Task Nudger)       → standalone (uses existing cron + gws)
F02 (Calendar Alerts)   → standalone (uses gws calendar)
F11 (Weather)           → standalone (uses curl + NWS API)
F04 (Documents)         → standalone (extends WhatsApp adapter)
F03 (Voice)             → depends on F04 (audio download)
F05 (CompanyCam)        → depends on F04 (send images)
F06 (Invoice Assistant) → depends on F05 (CompanyCam data)
F10 (Team Features)     → depends on F04 (relay messages)
F14 (Routines)          → depends on F01 (morning pattern), F15 (model routing)
```

**Optimal execution order (maximizes parallelism)**:
1. F15 + F08 + F20 in parallel (no deps, small scope)
2. F01 + F07 + F02 + F11 in parallel (all standalone watchers/crons)
3. F04 (document handling — unlocks others)
4. F03 + F05 in parallel (both depend on F04)
5. F10 + F14 (team + routines)
6. F06 (invoice assistant — depends on everything)

---

*End of Implementation Plans v1.0*
