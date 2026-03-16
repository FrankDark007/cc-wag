import { execSync } from 'child_process'
import fs from 'fs'

/**
 * End-of-Day Summary Feature
 * Sends a daily summary at 6 PM via WhatsApp
 *
 * Summarizes: tasks completed, conversations had, observations saved, pending items
 * Commands: /summary - on-demand summary
 */

import config from '../config.js'

const GWS = config.paths.gwsBin
const GWS_WORK = config.paths.gwsWorkScript
const FRANK_CHAT_ID = '17034981581@s.whatsapp.net'
const WORKSPACE = config.paths.workspace
const MEMORY_DIR = config.paths.memoryDir
const OBSERVATIONS_FILE = config.paths.observationsFile
const TRANSCRIPTS_DIR = config.paths.transcriptsDir

const SUMMARY_HOUR = 18 // 6 PM
const SUMMARY_MINUTE = 0

/**
 * Run a shell command safely
 */
function run(cmd, timeoutMs = 15000) {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: timeoutMs }).trim()
  } catch {
    return null
  }
}

/**
 * Count today's conversations from transcripts
 */
function getTodayConversationCount() {
  try {
    if (!fs.existsSync(TRANSCRIPTS_DIR)) return 0

    const files = fs.readdirSync(TRANSCRIPTS_DIR).filter(f => f.endsWith('.jsonl'))
    let count = 0
    const todayStr = new Date().toISOString().split('T')[0]

    for (const file of files) {
      const stat = fs.statSync(`${TRANSCRIPTS_DIR}/${file}`)
      // Count files modified today
      if (stat.mtime.toISOString().split('T')[0] === todayStr) {
        count++
      }
    }

    return count
  } catch {
    return 0
  }
}

/**
 * Count today's observations
 */
function getTodayObservations() {
  try {
    if (!fs.existsSync(OBSERVATIONS_FILE)) return { count: 0, domains: {} }

    const raw = fs.readFileSync(OBSERVATIONS_FILE, 'utf-8').trim()
    if (!raw) return { count: 0, domains: {} }

    const todayStr = new Date().toISOString().split('T')[0]
    const todayObs = raw.split('\n')
      .map(line => { try { return JSON.parse(line) } catch { return null } })
      .filter(o => o && o.date && o.date.startsWith(todayStr))

    const domains = {}
    for (const obs of todayObs) {
      const d = obs.domain || 'general'
      domains[d] = (domains[d] || 0) + 1
    }

    return { count: todayObs.length, domains }
  } catch {
    return { count: 0, domains: {} }
  }
}

/**
 * Get today's daily memory notes
 */
function getTodayNotes() {
  const todayStr = new Date().toISOString().split('T')[0]
  const dailyFile = `${MEMORY_DIR}/${todayStr}.md`

  try {
    if (fs.existsSync(dailyFile)) {
      const content = fs.readFileSync(dailyFile, 'utf-8')
      // Count sections (## headers = roughly one note per section)
      const sections = content.split('\n').filter(l => l.startsWith('## ')).length
      return sections
    }
  } catch {}

  return 0
}

/**
 * Get pending task count
 */
function getPendingTaskCount() {
  const FD_LIST = 'WUlnZzdORlJwa01PTEFVSw'
  const raw = run(`${GWS} tasks tasks list --tasklist "${FD_LIST}" --showCompleted false`)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw)
    const tasks = parsed.items || parsed || []
    return tasks.length
  } catch {
    return null
  }
}

/**
 * Check team inbox size
 */
function getTeamInboxCount() {
  const inboxFile = `${MEMORY_DIR}/team-inbox.jsonl`
  try {
    if (!fs.existsSync(inboxFile)) return 0
    const raw = fs.readFileSync(inboxFile, 'utf-8').trim()
    if (!raw) return 0
    return raw.split('\n').length
  } catch {
    return 0
  }
}

/**
 * Build the end-of-day summary
 */
export function buildSummary() {
  const now = new Date()
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  })

  const conversations = getTodayConversationCount()
  const observations = getTodayObservations()
  const notes = getTodayNotes()
  const pendingTasks = getPendingTaskCount()
  const teamInbox = getTeamInboxCount()

  const parts = [
    `End of Day Summary`,
    dateStr,
    ''
  ]

  // Activity section
  parts.push('--- ACTIVITY ---')
  parts.push(`Conversations: ${conversations}`)
  if (observations.count > 0) {
    const domainList = Object.entries(observations.domains).map(([d, c]) => `${d}(${c})`).join(', ')
    parts.push(`Observations saved: ${observations.count} (${domainList})`)
  }
  if (notes > 0) parts.push(`Daily notes: ${notes}`)

  // Pending section
  parts.push('')
  parts.push('--- PENDING ---')
  if (pendingTasks !== null) {
    parts.push(`Open tasks: ${pendingTasks}`)
  }
  if (teamInbox > 0) {
    parts.push(`Team inbox: ${teamInbox} unread`)
  }

  // Tomorrow
  const tomorrow = run(`${GWS} calendar +agenda --days 1`)
  if (tomorrow && tomorrow.trim()) {
    parts.push('')
    parts.push('--- TOMORROW ---')
    const lines = tomorrow.split('\n').filter(l => l.trim()).slice(0, 5)
    parts.push(lines.join('\n') || 'No events scheduled')
  }

  parts.push('')
  parts.push('Good night. Everything is saved.')

  return parts.join('\n')
}

/**
 * Register the daily summary feature
 */
export function register(gateway) {
  // Add /summary command
  const originalExecute = gateway.commandHandler.execute.bind(gateway.commandHandler)

  gateway.commandHandler.execute = async function (text, sessionKey, adapter, chatId) {
    const trimmed = text.trim().toLowerCase()

    if (trimmed === '/summary' || trimmed === '/summary now' || trimmed === '/eod') {
      try {
        const summary = buildSummary()
        return { handled: true, response: `🔱 *Atlas*\n\n${summary}` }
      } catch (err) {
        return { handled: true, response: `Summary failed: ${err.message}` }
      }
    }

    return originalExecute(text, sessionKey, adapter, chatId)
  }

  // Schedule daily summary at 6 PM
  let lastSummaryDate = null
  const timer = setInterval(() => {
    const now = new Date()
    const todayStr = now.toISOString().split('T')[0]

    if (lastSummaryDate === todayStr) return

    const day = now.getDay()
    if (day === 0) return // Skip Sunday

    const hour = now.getHours()
    const minute = now.getMinutes()
    if (hour !== SUMMARY_HOUR || minute !== SUMMARY_MINUTE) return

    lastSummaryDate = todayStr

    const adapter = gateway.adapters.get('whatsapp')
    if (!adapter) return

    try {
      const summary = buildSummary()
      adapter.sendMessage(FRANK_CHAT_ID, `🔱 *Atlas*\n\n${summary}`)
        .then(() => console.log('[DailySummary] Sent end-of-day summary'))
        .catch(err => console.error('[DailySummary] Send failed:', err.message))
    } catch (err) {
      console.error('[DailySummary] Build failed:', err.message)
    }
  }, 60000)

  gateway._dailySummaryTimer = timer

  console.log(`[DailySummary] Scheduled at ${SUMMARY_HOUR}:${String(SUMMARY_MINUTE).padStart(2, '0')} PM Mon-Sat, /summary and /eod commands enabled`)
}
