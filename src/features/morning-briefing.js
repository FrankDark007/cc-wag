import { execSync } from 'child_process'

/**
 * Morning Briefing Feature
 * Sends an organized morning briefing at 7:30 AM via WhatsApp
 *
 * Includes: weather, calendar, urgent emails, overdue tasks
 * Commands: /briefing - on-demand briefing
 *
 * Uses simple interval timer (checks every 60s).
 * No coupling to cron scheduler internals.
 */

const GWS = '/opt/homebrew/bin/gws'
const GWS_WORK = '/Users/ghost/Projects/cc-wag/scripts/gws-work.sh'

// Frank's DM chat ID (self-chat)
const FRANK_CHAT_ID = '17034981581@s.whatsapp.net'

// Briefing time: 7:30 AM ET (hour, minute)
const BRIEFING_HOUR = 7
const BRIEFING_MINUTE = 30

/**
 * Run a shell command safely, return output or null
 */
function run(cmd, timeoutMs = 15000) {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: timeoutMs }).trim()
  } catch {
    return null
  }
}

/**
 * Get today's calendar agenda
 */
function getCalendarAgenda() {
  const raw = run(`${GWS} calendar +agenda --days 1`)
  if (!raw) return 'Could not fetch calendar'

  const lines = raw.split('\n').filter(l => l.trim())
  if (lines.length === 0) return 'No events today'

  return lines.slice(0, 10).join('\n')
}

/**
 * Get pending tasks (overdue + due today + upcoming)
 */
function getTaskSummary() {
  const FD_LIST = 'WUlnZzdORlJwa01PTEFVSw'
  const raw = run(`${GWS} tasks tasks list --tasklist "${FD_LIST}" --showCompleted false`)
  if (!raw) return 'Could not fetch tasks'

  let tasks
  try {
    const parsed = JSON.parse(raw)
    tasks = parsed.items || parsed || []
  } catch {
    return raw.substring(0, 500)
  }

  if (!tasks.length) return 'No pending tasks'

  const todayStr = new Date().toISOString().split('T')[0]
  const overdue = []
  const dueToday = []
  const upcoming = []

  for (const t of tasks) {
    const title = t.title || 'Untitled'
    if (!t.due) {
      upcoming.push(title)
      continue
    }
    const dueDate = t.due.split('T')[0]
    if (dueDate < todayStr) {
      overdue.push(`${title} (was due ${formatDate(t.due)})`)
    } else if (dueDate === todayStr) {
      dueToday.push(title)
    } else {
      upcoming.push(`${title} (${formatDate(t.due)})`)
    }
  }

  const parts = []
  if (overdue.length) parts.push(`OVERDUE:\n${overdue.join('\n')}`)
  if (dueToday.length) parts.push(`DUE TODAY:\n${dueToday.join('\n')}`)
  if (upcoming.length) {
    const shown = upcoming.slice(0, 5)
    const extra = upcoming.length > 5 ? `\n+${upcoming.length - 5} more` : ''
    parts.push(`UPCOMING:\n${shown.join('\n')}${extra}`)
  }

  return parts.join('\n\n') || 'No pending tasks'
}

function formatDate(isoStr) {
  return new Date(isoStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * Get recent unread emails from work Gmail
 */
function getUrgentEmails() {
  const raw = run(`${GWS_WORK} gmail +triage --max 5`, 20000)
  if (!raw) return 'Could not fetch emails'

  const lines = raw.split('\n').filter(l => l.trim())
  if (lines.length === 0) return 'Inbox clear'

  return lines.slice(0, 8).join('\n')
}

/**
 * Get current weather for Northern Virginia
 */
function getWeather() {
  const raw = run('curl -s "wttr.in/Vienna+VA?format=%C+%t+%w&m"', 10000)
  if (!raw || raw.includes('Unknown') || raw.includes('<!')) return null
  return raw
}

/**
 * Build the full morning briefing message
 */
export function buildBriefing() {
  const now = new Date()
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  })

  const weather = getWeather()
  const calendar = getCalendarAgenda()
  const tasks = getTaskSummary()
  const emails = getUrgentEmails()

  const parts = [
    `Good morning Frank`,
    dateStr,
  ]

  if (weather) parts.push(`\nWeather: ${weather}`)

  parts.push(
    `\n--- SCHEDULE ---\n${calendar}`,
    `\n--- TASKS ---\n${tasks}`,
    `\n--- EMAIL ---\n${emails}`,
    `\nReply for details on anything above.`
  )

  return parts.join('\n')
}

/**
 * Register the morning briefing feature
 */
export function register(gateway) {
  // --- Add /briefing command ---
  const originalExecute = gateway.commandHandler.execute.bind(gateway.commandHandler)

  gateway.commandHandler.execute = async function (text, sessionKey, adapter, chatId) {
    const trimmed = text.trim().toLowerCase()

    if (trimmed === '/briefing' || trimmed === '/briefing now') {
      try {
        const briefing = buildBriefing()
        return { handled: true, response: `🔱 *Atlas Morning Briefing*\n\n${briefing}` }
      } catch (err) {
        return { handled: true, response: `Briefing failed: ${err.message}` }
      }
    }

    return originalExecute(text, sessionKey, adapter, chatId)
  }

  // --- Schedule daily briefing ---
  let lastBriefingDate = null
  const timer = setInterval(() => {
    const now = new Date()
    const todayStr = now.toISOString().split('T')[0]

    // Already sent today?
    if (lastBriefingDate === todayStr) return

    // Is it the right time? (7:30 AM, Mon-Sat)
    const day = now.getDay() // 0=Sun
    if (day === 0) return // Skip Sunday

    const hour = now.getHours()
    const minute = now.getMinutes()
    if (hour !== BRIEFING_HOUR || minute !== BRIEFING_MINUTE) return

    // Send briefing
    lastBriefingDate = todayStr

    const adapter = gateway.adapters.get('whatsapp')
    if (!adapter) {
      console.log('[MorningBriefing] No WhatsApp adapter, skipping')
      return
    }

    try {
      const briefing = buildBriefing()
      adapter.sendMessage(FRANK_CHAT_ID, `🔱 *Atlas Morning Briefing*\n\n${briefing}`)
        .then(() => console.log('[MorningBriefing] Sent daily briefing'))
        .catch(err => console.error('[MorningBriefing] Send failed:', err.message))
    } catch (err) {
      console.error('[MorningBriefing] Build failed:', err.message)
    }
  }, 60000) // Check every minute

  // Store timer ref for cleanup
  gateway._morningBriefingTimer = timer

  console.log(`[MorningBriefing] Scheduled at ${BRIEFING_HOUR}:${String(BRIEFING_MINUTE).padStart(2, '0')} AM Mon-Sat, /briefing command enabled`)
}
