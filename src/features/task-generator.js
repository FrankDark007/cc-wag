import fs from 'fs'
import path from 'path'

/**
 * Task Generator Feature
 * Proactively scans job data and suggests actions to Frank.
 *
 * Cron: Every 2 hours during work hours (10am, 12pm, 2pm, 4pm, 6pm, 8pm, 10pm)
 *
 * Scans for:
 *   1. Jobs completed >14 days with no invoice
 *   2. Jobs invoiced >30 days with no payment
 *   3. Lien deadlines <30 days with no action
 *   4. Equipment deployed >14 days
 *   5. Jobs with 0% data completeness
 *   6. Stale jobs (no activity >30 days)
 *
 * Commands:
 *   /suggest         - Run suggestion scan now
 *   /suggest stats   - Show acceptance statistics
 *   /suggest off     - Disable automatic suggestions
 *   /suggest on      - Re-enable automatic suggestions
 *
 * Storage: workspace/task-generator-state.json
 */

import config from '../config.js'

const WORKSPACE = config.paths.workspace
const STATE_FILE = path.join(WORKSPACE, 'task-generator-state.json')
const JOBS_FILE = path.join(WORKSPACE, 'jobs.json')
const EQUIP_FILE = path.join(WORKSPACE, 'equipment.json')
const FRANK_CHAT_ID = '17034981581@s.whatsapp.net'
const MS_PER_DAY = 86400000

// Cron schedule: these hours (local time)
const SCAN_HOURS = [10, 12, 14, 16, 18, 20, 22]

// ── Storage ──────────────────────────────────────────────────────────

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
    }
  } catch (err) {
    console.error('[TaskGen] Failed to load state:', err.message)
  }
  return { lastRun: null, suggestions: [], pendingSuggestions: {}, stats: { totalSuggested: 0, totalAccepted: 0, totalSkipped: 0 }, enabled: true }
}

function saveState(state) {
  const dir = path.dirname(STATE_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

function loadJobs() {
  try {
    if (fs.existsSync(JOBS_FILE)) {
      const raw = fs.readFileSync(JOBS_FILE, 'utf-8')
      const data = JSON.parse(raw)
      if (Array.isArray(data)) return { nextId: data.length + 1, jobs: data }
      return data
    }
  } catch (err) {
    console.error('[TaskGen] Failed to load jobs:', err.message)
  }
  return { nextId: 1, jobs: [] }
}

function loadEquipment() {
  try {
    if (fs.existsSync(EQUIP_FILE)) {
      return JSON.parse(fs.readFileSync(EQUIP_FILE, 'utf-8'))
    }
  } catch (err) {
    console.error('[TaskGen] Failed to load equipment:', err.message)
  }
  return { equipment: [] }
}

function daysAgo(isoStr) {
  if (!isoStr) return Infinity
  const d = new Date(isoStr)
  if (isNaN(d.getTime())) return Infinity
  return Math.floor((Date.now() - d.getTime()) / MS_PER_DAY)
}

function daysUntil(isoStr) {
  if (!isoStr) return Infinity
  const d = new Date(isoStr)
  if (isNaN(d.getTime())) return Infinity
  return Math.ceil((d.getTime() - Date.now()) / MS_PER_DAY)
}

// ── Scanners ─────────────────────────────────────────────────────────

function scanForSuggestions() {
  const suggestions = []
  const { jobs } = loadJobs()
  const equipData = loadEquipment()
  const equipment = equipData.equipment || []

  for (const job of jobs) {
    const status = (job.status || '').toLowerCase()

    // Skip closed/paid jobs
    if (['paid', 'closed'].includes(status)) continue

    // 1. Completed >14 days, no invoice
    if (status === 'needs-invoice' || status === 'completed') {
      const completed = daysAgo(job.dateCompleted)
      if (completed > 14 && completed !== Infinity) {
        suggestions.push({
          type: 'no-invoice',
          jobId: job.id,
          client: job.client || job.clientName || 'Unknown',
          detail: `completed ${completed} days ago`,
          action: `/scope ${job.id}`,
          priority: completed > 30 ? 'high' : 'medium'
        })
      }
    }

    // 2. Invoiced >30 days, no payment
    if (['invoiced', 'payment-pending'].includes(status) && job.invoiceDate) {
      const invoiceDays = daysAgo(job.invoiceDate)
      if (invoiceDays > 30) {
        suggestions.push({
          type: 'unpaid',
          jobId: job.id,
          client: job.client || job.clientName || 'Unknown',
          detail: `invoiced ${invoiceDays} days ago`,
          action: `/nudge ${job.id}`,
          priority: invoiceDays > 60 ? 'high' : 'medium'
        })
      }
    }

    // 3. Lien deadline <30 days with no action
    if (job.lienDeadline && !['lien-filed', 'paid', 'closed'].includes(status)) {
      const daysLeft = daysUntil(job.lienDeadline)
      if (daysLeft < 30 && daysLeft > 0) {
        suggestions.push({
          type: 'lien-deadline',
          jobId: job.id,
          client: job.client || job.clientName || 'Unknown',
          detail: `lien deadline in ${daysLeft} days`,
          action: `File lien for ${job.id}`,
          priority: daysLeft < 14 ? 'high' : 'medium'
        })
      }
    }

    // 5. Jobs with missing critical data (0% completeness proxy)
    const hasAddress = job.address && String(job.address).trim()
    const hasClient = job.client || job.clientName
    const hasAdjuster = job.adjuster && String(job.adjuster).trim()
    const missing = [!hasAddress && 'address', !hasClient && 'client', !hasAdjuster && 'adjuster'].filter(Boolean)
    if (missing.length >= 2) {
      suggestions.push({
        type: 'incomplete-data',
        jobId: job.id,
        client: job.client || job.clientName || 'Unknown',
        detail: `missing ${missing.join(', ')}`,
        action: `/audit fix ${job.id}`,
        priority: 'low'
      })
    }

    // 6. Stale jobs (no activity >30 days)
    const lastActivity = job.lastActivity || job.updatedAt || job.dateCompleted || job.invoiceDate || job.createdAt
    if (lastActivity) {
      const staleDays = daysAgo(lastActivity)
      if (staleDays > 30 && !['paid', 'closed', 'needs-invoice'].includes(status)) {
        suggestions.push({
          type: 'stale',
          jobId: job.id,
          client: job.client || job.clientName || 'Unknown',
          detail: `no activity for ${staleDays} days`,
          action: `Update status for ${job.id}`,
          priority: 'low'
        })
      }
    }
  }

  // 4. Equipment deployed >14 days
  for (const eq of equipment) {
    const eqStatus = (eq.status || '').toLowerCase()
    if (eqStatus === 'deployed' && eq.deployedDate) {
      const deployDays = daysAgo(eq.deployedDate)
      if (deployDays > 14) {
        suggestions.push({
          type: 'equipment-overdue',
          jobId: eq.deployedTo || eq.jobId || 'unknown',
          client: eq.name || eq.id || 'Equipment',
          detail: `deployed ${deployDays} days on ${eq.deployedTo || 'unknown job'}`,
          action: `/equip return ${eq.id}`,
          priority: deployDays > 21 ? 'medium' : 'low'
        })
      }
    }
  }

  // Sort by priority: high > medium > low
  const priorityOrder = { high: 0, medium: 1, low: 2 }
  suggestions.sort((a, b) => (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2))

  return suggestions
}

// ── Formatting ───────────────────────────────────────────────────────

const TYPE_EMOJI = {
  'no-invoice': '\uD83D\uDCDD',
  'unpaid': '\uD83D\uDCB8',
  'lien-deadline': '\u26A0\uFE0F',
  'equipment-overdue': '\uD83D\uDEE0\uFE0F',
  'incomplete-data': '\uD83D\uDCC1',
  'stale': '\uD83D\uDCA4'
}

function formatSuggestions(suggestions) {
  if (!suggestions.length) {
    return '\uD83D\uDCA1 *Atlas Suggestions*\n\u2501'.repeat(1) + '\u2501'.repeat(18) + '\n\nNo suggestions right now. Everything looks good!'
  }

  const lines = [
    '\uD83D\uDCA1 *Atlas Suggestions*',
    '\u2501'.repeat(19),
    ''
  ]

  for (let i = 0; i < suggestions.length; i++) {
    const s = suggestions[i]
    const emoji = TYPE_EMOJI[s.type] || '\u2022'
    const priorityTag = s.priority === 'high' ? ' \uD83D\uDD34' : ''
    lines.push(`${i + 1}. ${emoji} ${s.jobId} ${s.client} \u2014 ${s.detail}${priorityTag}`)
    lines.push(`   ${s.action}`)
  }

  lines.push('')
  lines.push('Reply with numbers to act (e.g., "1 3") or "skip all"')

  return lines.join('\n')
}

function formatStats() {
  const state = loadState()
  const { stats } = state

  const total = stats.totalAccepted + stats.totalSkipped
  const rate = total > 0 ? Math.round((stats.totalAccepted / total) * 100) : 0

  return [
    '\uD83D\uDCCA *Suggestion Stats*',
    '\u2501'.repeat(19),
    '',
    `Total suggested: ${stats.totalSuggested}`,
    `Accepted: ${stats.totalAccepted}`,
    `Skipped: ${stats.totalSkipped}`,
    `Acceptance rate: ${rate}%`,
    '',
    `Auto-suggestions: ${state.enabled ? 'ON' : 'OFF'}`,
    state.lastRun ? `Last scan: ${new Date(state.lastRun).toLocaleString()}` : 'Last scan: never'
  ].join('\n')
}

// ── Response Handling ────────────────────────────────────────────────

function handleSuggestionResponse(text, chatId) {
  const state = loadState()
  const pending = state.pendingSuggestions[chatId]
  if (!pending || !pending.length) return null

  const lower = text.trim().toLowerCase()

  if (lower === 'skip all' || lower === 'skip') {
    state.stats.totalSkipped += pending.length
    delete state.pendingSuggestions[chatId]
    saveState(state)
    return 'Skipped all suggestions.'
  }

  // Parse numbers like "1 3" or "1, 3" or "1,3"
  const nums = text.match(/\d+/g)
  if (!nums) return null

  const indices = nums.map(n => parseInt(n, 10) - 1).filter(i => i >= 0 && i < pending.length)
  if (!indices.length) return null

  const accepted = indices.map(i => pending[i])
  const skipped = pending.filter((_, i) => !indices.includes(i))

  state.stats.totalAccepted += accepted.length
  state.stats.totalSkipped += skipped.length
  delete state.pendingSuggestions[chatId]
  saveState(state)

  const lines = ['Acting on:']
  for (const s of accepted) {
    lines.push(`- ${s.action}`)
  }
  lines.push('')
  lines.push(`Run these commands to proceed.`)

  return lines.join('\n')
}

// ── Command Router ───────────────────────────────────────────────────

function handleSuggest(text, gateway) {
  const body = text.replace(/^\/suggest\s*/i, '').trim().toLowerCase()

  if (body === 'stats') return formatStats()

  if (body === 'off') {
    const state = loadState()
    state.enabled = false
    saveState(state)
    return 'Automatic suggestions disabled. Use /suggest to scan manually.'
  }

  if (body === 'on') {
    const state = loadState()
    state.enabled = true
    saveState(state)
    return 'Automatic suggestions re-enabled.'
  }

  // Run scan now
  const suggestions = scanForSuggestions()
  const state = loadState()
  state.lastRun = new Date().toISOString()
  state.stats.totalSuggested += suggestions.length

  if (suggestions.length > 0) {
    state.pendingSuggestions[FRANK_CHAT_ID] = suggestions
  }

  saveState(state)
  return formatSuggestions(suggestions)
}

// ── Cron ─────────────────────────────────────────────────────────────

function setupCron(gateway) {
  let lastScanHour = -1
  let lastScanDate = ''

  const timer = setInterval(() => {
    const state = loadState()
    if (!state.enabled) return

    const now = new Date()
    const hour = now.getHours()
    const today = now.toISOString().slice(0, 10)

    // Only scan at scheduled hours, once per hour per day
    if (!SCAN_HOURS.includes(hour)) return
    if (lastScanDate === today && lastScanHour === hour) return

    lastScanHour = hour
    lastScanDate = today

    const suggestions = scanForSuggestions()
    if (!suggestions.length) return

    // Update state
    state.lastRun = now.toISOString()
    state.stats.totalSuggested += suggestions.length
    state.pendingSuggestions[FRANK_CHAT_ID] = suggestions
    saveState(state)

    // Send to Frank
    const msg = formatSuggestions(suggestions)
    const adapter = gateway.adapters.get('whatsapp')
    if (!adapter) {
      console.log('[TaskGen] No WhatsApp adapter for cron')
      return
    }

    adapter.sendMessage(FRANK_CHAT_ID, msg)
      .then(() => console.log(`[TaskGen] Sent ${suggestions.length} suggestions to Frank`))
      .catch(err => console.error('[TaskGen] Send failed:', err.message))
  }, 60000) // Check every minute

  gateway._taskGenTimer = timer
}

// ── Register ─────────────────────────────────────────────────────────

export function register(gateway) {
  const originalExecute = gateway.commandHandler.execute.bind(gateway.commandHandler)

  gateway.commandHandler.execute = async function (text, sessionKey, adapter, chatId) {
    const lower = text.trim().toLowerCase()

    // Check if this is a response to pending suggestions
    if (chatId) {
      const state = loadState()
      if (state.pendingSuggestions[chatId] && state.pendingSuggestions[chatId].length) {
        const response = handleSuggestionResponse(text, chatId)
        if (response) return { handled: true, response }
      }
    }

    // Handle /suggest commands
    if (lower.startsWith('/suggest')) {
      const response = handleSuggest(text.trim(), gateway)
      return { handled: true, response }
    }

    return originalExecute(text, sessionKey, adapter, chatId)
  }

  // Expose API
  gateway._taskGenerator = {
    scan: scanForSuggestions,
    getState: loadState
  }

  setupCron(gateway)
  console.log('[TaskGen] Feature loaded — /suggest commands, cron every 2h (10am-10pm)')
}
