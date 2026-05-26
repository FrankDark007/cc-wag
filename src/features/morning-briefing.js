import { execSync } from 'child_process'
import config from '../config.js'

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

const GWS = config.paths.gwsBin
const GWS_WORK = config.paths.gwsWorkScript

// Frank's DM chat ID (self-chat)
const FRANK_CHAT_ID = '17034981581@s.whatsapp.net'

// Briefing time: 10:30 AM ET (Frank works late, sleeps ~5am-10/11am)
const BRIEFING_HOUR = 10
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
  const raw = run(`${GWS} tasks tasks list --params '{"tasklist":"${FD_LIST}","showCompleted":false}'`)
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
 * @param {object} [gateway] - Gateway instance for integration sections
 */
export function buildBriefing(gateway) {
  const now = new Date()
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  })

  const calendar = getCalendarAgenda()
  const tasks = getTaskSummary()
  const emails = getUrgentEmails()

  const parts = [
    `🔱 *Atlas Daily Briefing*`,
    dateStr,
  ]

  parts.push(
    `\n--- SCHEDULE ---\n${calendar}`,
    `\n--- TASKS ---\n${tasks}`,
    `\n--- EMAIL ---\n${emails}`
  )

  // ── Integration Sections (only if features are loaded) ──────────

  // Job Health section
  if (gateway && gateway._healthMonitor) {
    try {
      const summary = gateway._healthMonitor.getHealthSummary()
      const all = gateway._healthMonitor.getAllHealth()
      const topConcerns = all.slice(0, 3)
      const concernStr = topConcerns.length
        ? topConcerns.map(h => {
            const topIssue = h.penalties[0]
            const detail = topIssue ? topIssue.reason.replace(/^(Missing |No |Stale|Lien deadline|Unpaid|Open)/, '').trim().toLowerCase() : ''
            return `${h.jobId} (${detail || h.score + ' pts'})`
          }).join(', ')
        : 'none'

      parts.push(
        `\n--- JOB HEALTH ---`,
        `\uD83C\uDFE5 *Job Health*`,
        `\uD83D\uDD34 ${summary.red} critical | \uD83D\uDFE0 ${summary.orange} warning | \uD83D\uDFE1 ${summary.yellow} ok | \uD83D\uDFE2 ${summary.green} healthy`,
        `Top concerns: ${concernStr}`
      )
    } catch (err) {
      console.error('[MorningBriefing] Health section failed:', err.message)
    }
  }

  // Revenue section
  if (gateway && gateway.dataIntegrator) {
    try {
      const dashboard = gateway.dataIntegrator.getDashboard()
      const { revenue } = dashboard
      const fmtInvoiced = formatDollars(revenue.totalInvoiced)
      const fmtPaid = formatDollars(revenue.totalPaid)
      const fmtOutstanding = formatDollars(revenue.totalOutstanding)

      parts.push(
        `\n--- REVENUE ---`,
        `\uD83D\uDCB0 *Revenue*`,
        `Invoiced: ${fmtInvoiced} | Paid: ${fmtPaid} | Outstanding: ${fmtOutstanding}`
      )
    } catch (err) {
      console.error('[MorningBriefing] Revenue section failed:', err.message)
    }
  }

  // Equipment section
  if (gateway && gateway._equipmentTracker) {
    try {
      const summary = gateway._equipmentTracker.getEquipmentSummary()
      const equipLine = `${summary.deployed} deployed | ${summary.available} available | ${summary.maintenance} maintenance`
      const equipParts = [
        `\n--- EQUIPMENT ---`,
        `\uD83D\uDD27 *Equipment*`,
        equipLine
      ]

      // Check for long-deployed units via average days
      if (summary.deployed > 0) {
        // Count units over 14 days — pull from getActiveEquipmentDays avg
        const totalDays = gateway._equipmentTracker.getActiveEquipmentDays()
        const avgDays = summary.deployed > 0 ? Math.round(totalDays / summary.deployed) : 0
        if (avgDays > 14) {
          equipParts.push(`\u26A0\uFE0F Avg deployment: ${avgDays} days (high)`)
        }
      }

      parts.push(...equipParts)
    } catch (err) {
      console.error('[MorningBriefing] Equipment section failed:', err.message)
    }
  }

  // Disputes & Liens section
  if (gateway && gateway.dataIntegrator) {
    try {
      const dashboard = gateway.dataIntegrator.getDashboard()
      const { disputes, liens } = dashboard

      if (disputes.open > 0 || liens.critical > 0) {
        const disputeStr = disputes.open > 0
          ? `${disputes.open} open dispute${disputes.open > 1 ? 's' : ''} (${formatDollars(disputes.totalAmount)})`
          : 'No open disputes'
        const lienStr = liens.critical > 0
          ? `${liens.critical} lien${liens.critical > 1 ? 's' : ''} <30 days`
          : 'No urgent liens'

        parts.push(
          `\n--- DISPUTES & LIENS ---`,
          `\u26A0\uFE0F *Disputes & Liens*`,
          `${disputeStr} | ${lienStr}`
        )
      }
    } catch (err) {
      console.error('[MorningBriefing] Disputes section failed:', err.message)
    }
  }

  parts.push(`\nReply for details on anything above.`)

  return parts.join('\n')
}

/**
 * Format dollars number as "$X,XXX"
 */
function formatDollars(amount) {
  if (amount == null || isNaN(amount)) return '$0'
  return '$' + Number(amount).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
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
        const briefing = buildBriefing(gateway)
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
      const briefing = buildBriefing(gateway)
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
