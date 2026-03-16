import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

/**
 * Email Action Items Feature
 * Cron (every 30 min): reads recent work emails, categorizes as
 * urgent/action/info/ignore. Extracts action items. Stores in
 * workspace/email-actions.json.
 *
 * Commands:
 *   /actions        — show pending action items
 *   /actions clear  — archive all current actions
 *
 * Uses gws-work.sh for work email (frankd@flooddoctorva.com)
 */

const GWS_WORK = '/Users/ghost/Projects/cc-wag/scripts/gws-work.sh'
const ACTIONS_FILE = '/Users/ghost/Projects/cc-wag/workspace/email-actions.json'
const STATE_FILE = '/Users/ghost/Projects/cc-wag/workspace/email-actions-state.json'
const FRANK_CHAT_ID = '17034981581@s.whatsapp.net'
const CHECK_INTERVAL = 30 * 60 * 1000 // 30 minutes

// Quiet hours: no WhatsApp alerts before 10am
const QUIET_HOUR_END = 10

// ── Category detection patterns ─────────────────────────────────────

const URGENT_PATTERNS = [
  /urgent/i,
  /immediate/i,
  /asap/i,
  /deadline\s+(today|tomorrow|is)/i,
  /lien/i,
  /court\s+(date|hearing|order)/i,
  /emergency/i,
  /final\s+notice/i,
  /time.?sensitive/i,
  /action\s+required/i,
]

const ACTION_PATTERNS = [
  /please\s+(send|provide|submit|complete|sign|return|review|approve|confirm|respond|reply|forward|upload)/i,
  /need\s+(you\s+to|from\s+you|the|your)/i,
  /requesting/i,
  /follow.?up/i,
  /awaiting\s+(your|response|documents|payment)/i,
  /by\s+(monday|tuesday|wednesday|thursday|friday|tomorrow|end\s+of|close\s+of|eod|cob)/i,
  /can\s+you\s+(send|provide|confirm)/i,
  /reminding\s+you/i,
  /outstanding\s+(documents?|items?|balance|payment)/i,
  /attached\s+.*\s+(review|signature|approval)/i,
  /schedule\s+(a|an|the)\s+(inspection|meeting|call)/i,
]

const INFO_PATTERNS = [
  /fyi/i,
  /for\s+your\s+(information|records|reference)/i,
  /update\s+on/i,
  /status\s+update/i,
  /just\s+wanted\s+to\s+let\s+you\s+know/i,
  /confirmation/i,
  /receipt/i,
  /auto.?reply/i,
  /out\s+of\s+office/i,
  /no\s+reply\s+needed/i,
]

const IGNORE_PATTERNS = [
  /unsubscribe/i,
  /newsletter/i,
  /promotional/i,
  /marketing/i,
  /do\s+not\s+reply/i,
  /noreply/i,
  /no-reply/i,
  /automated\s+message/i,
]

// ── Shell helpers ───────────────────────────────────────────────────

function run(cmd, timeoutMs = 20000) {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: timeoutMs }).trim()
  } catch {
    return null
  }
}

function parseJSON(raw) {
  if (!raw) return null
  try {
    const jsonStart = raw.indexOf('{')
    const jsonArrayStart = raw.indexOf('[')
    const start = jsonStart === -1 ? jsonArrayStart
      : jsonArrayStart === -1 ? jsonStart
      : Math.min(jsonStart, jsonArrayStart)
    if (start === -1) return null
    return JSON.parse(raw.slice(start))
  } catch {
    return null
  }
}

// ── Storage ─────────────────────────────────────────────────────────

function loadActions() {
  try {
    if (fs.existsSync(ACTIONS_FILE)) {
      return JSON.parse(fs.readFileSync(ACTIONS_FILE, 'utf-8'))
    }
  } catch {}
  return { pending: [], archived: [] }
}

function saveActions(data) {
  const dir = path.dirname(ACTIONS_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  // Keep archives manageable — last 200
  data.archived = (data.archived || []).slice(-200)
  fs.writeFileSync(ACTIONS_FILE, JSON.stringify(data, null, 2))
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
    }
  } catch {}
  return { lastCheck: null, seenIds: [] }
}

function saveState(state) {
  try {
    state.seenIds = state.seenIds.slice(-500)
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
  } catch (err) {
    console.error('[EmailActions] Failed to save state:', err.message)
  }
}

// ── Categorization ──────────────────────────────────────────────────

function categorizeEmail(from, subject, snippet) {
  const text = `${from || ''} ${subject || ''} ${snippet || ''}`

  // Check ignore first
  if (IGNORE_PATTERNS.some(p => p.test(text))) return 'ignore'

  // Check urgent
  if (URGENT_PATTERNS.some(p => p.test(text))) return 'urgent'

  // Check action
  if (ACTION_PATTERNS.some(p => p.test(text))) return 'action'

  // Check info
  if (INFO_PATTERNS.some(p => p.test(text))) return 'info'

  // Default to info for anything that doesn't match
  return 'info'
}

/**
 * Extract a concise action item description from email content
 */
function extractActionItem(from, subject, snippet) {
  const senderName = from.replace(/<[^>]+>/, '').replace(/"/g, '').trim()
  const shortSender = senderName.split(/\s+/).slice(0, 2).join(' ')

  // Try to find specific action requests in snippet
  const actionMatch = (snippet || '').match(
    /(?:please|need|can you|kindly|requesting)\s+(.{10,80}?)(?:\.|,|$)/i
  )

  if (actionMatch) {
    return `${shortSender}: ${actionMatch[0].trim().substring(0, 100)}`
  }

  // Fall back to subject as the action item
  return `${shortSender}: ${(subject || 'No subject').substring(0, 100)}`
}

// ── Email scanning ──────────────────────────────────────────────────

function scanRecentEmails(state) {
  const query = 'is:unread newer_than:2h'
  const raw = run(`${GWS_WORK} gmail users messages list --q "${query}" --maxResults 20`)
  const parsed = parseJSON(raw)
  if (!parsed) return []

  const messages = parsed.messages || parsed || []
  if (!Array.isArray(messages)) return []

  const results = []

  for (const msg of messages) {
    const id = msg.id
    if (!id || state.seenIds.includes(id)) continue

    // Get message metadata + snippet
    const detail = run(
      `${GWS_WORK} gmail users messages get --id "${id}" --format metadata --metadataHeaders "From,Subject"`
    )
    const msgData = parseJSON(detail)
    if (!msgData) continue

    const headers = msgData.payload?.headers || []
    const from = headers.find(h => h.name === 'From')?.value || ''
    const subject = headers.find(h => h.name === 'Subject')?.value || ''
    const snippet = msgData.snippet || ''

    state.seenIds.push(id)

    const category = categorizeEmail(from, subject, snippet)

    // Skip ignored emails
    if (category === 'ignore') continue

    const actionItem = (category === 'urgent' || category === 'action')
      ? extractActionItem(from, subject, snippet)
      : null

    results.push({
      id,
      from: from.replace(/<[^>]+>/, '').replace(/"/g, '').trim(),
      subject: (subject || 'No subject').substring(0, 150),
      snippet: (snippet || '').substring(0, 200),
      category,
      actionItem,
      timestamp: new Date().toISOString()
    })
  }

  return results
}

// ── Main processing ─────────────────────────────────────────────────

async function processActions(gateway) {
  const state = loadState()
  const emails = scanRecentEmails(state)

  state.lastCheck = new Date().toISOString()
  saveState(state)

  if (emails.length === 0) return

  const actions = loadActions()
  let newUrgent = 0
  let newAction = 0

  for (const email of emails) {
    const entry = {
      id: email.id,
      from: email.from,
      subject: email.subject,
      category: email.category,
      actionItem: email.actionItem,
      timestamp: email.timestamp,
      resolved: false
    }

    actions.pending.push(entry)

    if (email.category === 'urgent') newUrgent++
    if (email.category === 'action') newAction++
  }

  saveActions(actions)

  // Send WhatsApp alert for urgent items only
  const hour = new Date().getHours()
  if (newUrgent > 0 && hour >= QUIET_HOUR_END) {
    const adapter = gateway.adapters.get('whatsapp')
    if (adapter) {
      const urgentItems = emails.filter(e => e.category === 'urgent')
      const lines = [
        `*Atlas: ${newUrgent} URGENT email${newUrgent > 1 ? 's' : ''} detected*`,
        ''
      ]
      for (const u of urgentItems) {
        lines.push(`From: ${u.from}`)
        lines.push(`Subject: ${u.subject}`)
        if (u.actionItem) lines.push(`Action: ${u.actionItem}`)
        lines.push('')
      }
      lines.push('Use /actions to see all pending items.')

      try {
        await adapter.sendMessage(FRANK_CHAT_ID, lines.join('\n'))
      } catch (err) {
        console.error('[EmailActions] Alert failed:', err.message)
      }
    }
  }

  console.log(
    `[EmailActions] Processed ${emails.length} email(s): ` +
    `${newUrgent} urgent, ${newAction} action, ` +
    `${emails.filter(e => e.category === 'info').length} info`
  )
}

// ── Command handlers ────────────────────────────────────────────────

function handleActions(argsStr) {
  const args = (argsStr || '').trim().toLowerCase()

  // /actions clear — archive all pending
  if (args === 'clear') {
    const actions = loadActions()
    if (actions.pending.length === 0) {
      return { handled: true, response: 'No pending action items to clear.' }
    }

    const count = actions.pending.length
    // Move all pending to archived
    for (const item of actions.pending) {
      item.resolved = true
      item.resolvedDate = new Date().toISOString()
      actions.archived.push(item)
    }
    actions.pending = []
    saveActions(actions)

    return { handled: true, response: `Archived ${count} action item${count > 1 ? 's' : ''}.` }
  }

  // /actions — show pending
  const actions = loadActions()

  if (actions.pending.length === 0) {
    return { handled: true, response: 'No pending action items. Inbox is clear.' }
  }

  // Group by category
  const urgent = actions.pending.filter(a => a.category === 'urgent')
  const action = actions.pending.filter(a => a.category === 'action')
  const info = actions.pending.filter(a => a.category === 'info')

  const lines = [`*Email Action Items* (${actions.pending.length} pending)`, '']

  if (urgent.length > 0) {
    lines.push(`*URGENT (${urgent.length}):*`)
    for (const u of urgent) {
      const age = timeSince(u.timestamp)
      lines.push(`  ${u.actionItem || u.subject} (${age})`)
    }
    lines.push('')
  }

  if (action.length > 0) {
    lines.push(`*ACTION NEEDED (${action.length}):*`)
    for (const a of action.slice(0, 10)) {
      const age = timeSince(a.timestamp)
      lines.push(`  ${a.actionItem || a.subject} (${age})`)
    }
    if (action.length > 10) lines.push(`  ... +${action.length - 10} more`)
    lines.push('')
  }

  if (info.length > 0) {
    lines.push(`*INFO (${info.length}):*`)
    for (const i of info.slice(0, 5)) {
      lines.push(`  ${i.from}: ${i.subject}`)
    }
    if (info.length > 5) lines.push(`  ... +${info.length - 5} more`)
    lines.push('')
  }

  lines.push('/actions clear to archive all')

  return { handled: true, response: lines.join('\n') }
}

function timeSince(isoStr) {
  const ms = Date.now() - new Date(isoStr).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

// ── Plugin Registration ─────────────────────────────────────────────

export function register(gateway) {
  // Ensure workspace directory exists
  const dir = path.dirname(ACTIONS_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  // Cron: check every 30 minutes
  const timer = setInterval(() => {
    processActions(gateway).catch(err => {
      console.error('[EmailActions] Process error:', err.message)
    })
  }, CHECK_INTERVAL)

  // Initial check after 4 minutes (let WhatsApp connect, after email-watcher)
  setTimeout(() => {
    processActions(gateway).catch(err => {
      console.error('[EmailActions] Initial check error:', err.message)
    })
  }, 4 * 60 * 1000)

  // Wrap the command handler to intercept /actions
  const originalExecute = gateway.commandHandler.execute.bind(gateway.commandHandler)

  gateway.commandHandler.execute = async function (text, sessionKey, adapter, chatId) {
    const lower = text.trim().toLowerCase()

    if (lower.startsWith('/actions')) {
      const rest = text.trim().slice(8).trim()
      const result = handleActions(rest)
      if (result) return result
    }

    return originalExecute(text, sessionKey, adapter, chatId)
  }

  // Extend /help output
  const originalHelp = gateway.commandHandler.handleHelp.bind(gateway.commandHandler)

  gateway.commandHandler.handleHelp = function () {
    const result = originalHelp()
    const actionLines = [
      '',
      '--- Email Actions ---',
      '/actions — Show pending email action items',
      '/actions clear — Archive all pending items',
    ]
    result.response += '\n' + actionLines.join('\n')
    return result
  }

  gateway._emailActionsTimer = timer

  console.log('[EmailActions] Loaded — scanning emails every 30 min, /actions command enabled')
}
