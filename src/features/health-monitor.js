import fs from 'fs'
import path from 'path'

/**
 * Health Monitor Feature
 * Calculates health scores (0-100) for each job and surfaces problems proactively.
 *
 * Commands:
 *   /health           - Summary by tier (red/orange/yellow/green)
 *   /health FD-XXX    - Detailed breakdown for one job
 *   /health red       - Show only red tier jobs
 *   /health orange    - Show only orange tier jobs
 *   /health top       - Show 10 most critical jobs
 *
 * Daily cron (10:45 AM): Alert on red jobs + new orange jobs
 *
 * API (gateway._healthMonitor):
 *   getJobHealth(jobId)  - { score, tier, penalties }
 *   getAllHealth()        - Sorted array of all jobs with health
 *   getHealthSummary()   - { red, orange, yellow, green, avg }
 */

import config from '../config.js'

const WORKSPACE = config.paths.workspace
const ALERT_STATE_FILE = path.join(WORKSPACE, 'health-alert-state.json')
const FRANK_CHAT_ID = '17034981581@s.whatsapp.net'
const MS_PER_DAY = 86400000

// ── Job Data Import (with fallback) ─────────────────────────────────

let jobData
try {
  jobData = await import('../utils/job-data.js')
} catch {
  // Minimal fallback
  jobData = {
    loadJobs() {
      try {
        const f = path.join(WORKSPACE, 'jobs.json')
        if (!fs.existsSync(f)) return { nextId: 1, jobs: [] }
        const raw = fs.readFileSync(f, 'utf-8')
        const data = JSON.parse(raw)
        if (Array.isArray(data)) return { nextId: data.length + 1, jobs: data }
        return data
      } catch { return { nextId: 1, jobs: [] } }
    },
    loadDisputes() {
      try {
        const f = path.join(WORKSPACE, 'disputes.json')
        if (!fs.existsSync(f)) return { disputes: [] }
        return JSON.parse(fs.readFileSync(f, 'utf-8'))
      } catch { return { disputes: [] } }
    },
    findJob(id) {
      const data = this.loadJobs()
      const upper = id.toUpperCase()
      return data.jobs.find(j => {
        if (j.id === upper) return true
        const num = parseInt(id, 10)
        if (!isNaN(num) && j.id === `FD-${String(num).padStart(3, '0')}`) return true
        return false
      }) || null
    },
    daysUntil(isoStr) {
      if (!isoStr) return Infinity
      const d = new Date(isoStr)
      if (isNaN(d.getTime())) return Infinity
      return Math.ceil((d.getTime() - Date.now()) / MS_PER_DAY)
    },
    daysAgo(isoStr) {
      if (!isoStr) return Infinity
      const d = new Date(isoStr)
      if (isNaN(d.getTime())) return Infinity
      return Math.floor((Date.now() - d.getTime()) / MS_PER_DAY)
    },
    formatMoneyDollars(dollars) {
      if (dollars == null || isNaN(dollars)) return '$0'
      return '$' + Number(dollars).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
    }
  }
}

// ── Health Score Calculation ─────────────────────────────────────────

function calculateHealth(job, disputes) {
  let score = 100
  const penalties = []

  // Missing address
  if (!job.address || !String(job.address).trim()) {
    score -= 10
    penalties.push({ points: -10, reason: 'Missing address' })
  }

  // Missing city
  if (!job.city || !String(job.city).trim()) {
    score -= 5
    penalties.push({ points: -5, reason: 'Missing city' })
  }

  // Missing adjuster
  if (!job.adjuster || !String(job.adjuster).trim()) {
    score -= 10
    penalties.push({ points: -10, reason: 'Missing adjuster' })
  }

  // Missing adjuster email
  if (!job.adjusterEmail || !String(job.adjusterEmail).trim()) {
    score -= 5
    penalties.push({ points: -5, reason: 'Missing adjuster email' })
  }

  // No invoice: status is needs-invoice and completed >14 days ago
  const status = (job.status || '').toLowerCase()
  if (status === 'needs-invoice' && job.dateCompleted) {
    const completedDays = jobData.daysAgo(job.dateCompleted)
    if (completedDays > 14) {
      score -= 15
      penalties.push({ points: -15, reason: `No invoice (completed ${completedDays} days ago)` })
    }
  }

  // No activity for >30 days (stale) — check lastActivity or dateCompleted or invoiceDate
  const lastActivity = job.lastActivity || job.updatedAt || job.dateCompleted || job.invoiceDate || job.createdAt
  if (lastActivity) {
    const staleDays = jobData.daysAgo(lastActivity)
    if (staleDays > 30 && !['paid', 'closed'].includes(status)) {
      score -= 15
      penalties.push({ points: -15, reason: `Stale — no activity for ${staleDays} days` })
    }
  }

  // Lien deadline proximity
  if (job.lienDeadline && !['paid', 'closed', 'lien-filed'].includes(status)) {
    const daysLeft = jobData.daysUntil(job.lienDeadline)
    if (daysLeft < 30) {
      score -= 20
      penalties.push({ points: -20, reason: `Lien deadline in ${daysLeft} days` })
    } else if (daysLeft < 60) {
      score -= 10
      penalties.push({ points: -10, reason: `Lien deadline in ${daysLeft} days` })
    }
  }

  // Open dispute
  const jobDisputes = disputes.filter(d =>
    d.jobId === job.id && (d.status || '').toLowerCase() !== 'resolved'
  )
  if (jobDisputes.length > 0) {
    score -= 15
    penalties.push({ points: -15, reason: `Open dispute` })
  }

  // Unpaid after invoicing
  if (['invoiced', 'payment-pending'].includes(status) && job.invoiceDate) {
    const daysSinceInvoice = jobData.daysAgo(job.invoiceDate)
    if (daysSinceInvoice > 60) {
      score -= 20
      penalties.push({ points: -10, reason: `Unpaid >30 days after invoicing` })
      penalties.push({ points: -10, reason: `Unpaid >60 days after invoicing` })
    } else if (daysSinceInvoice > 30) {
      score -= 10
      penalties.push({ points: -10, reason: `Unpaid >30 days after invoicing` })
    }
  }

  // Missing Drive folder
  if (!job.driveFolderId || !String(job.driveFolderId).trim()) {
    score -= 5
    penalties.push({ points: -5, reason: 'Missing Drive folder' })
  }

  // Clamp
  if (score < 0) score = 0

  return { score, penalties }
}

function getTier(score) {
  if (score <= 40) return { emoji: '\uD83D\uDD34', label: 'Red', tier: 'red' }
  if (score <= 60) return { emoji: '\uD83D\uDFE0', label: 'Orange', tier: 'orange' }
  if (score <= 80) return { emoji: '\uD83D\uDFE1', label: 'Yellow', tier: 'yellow' }
  return { emoji: '\uD83D\uDFE2', label: 'Green', tier: 'green' }
}

// ── Core API Functions ───────────────────────────────────────────────

function getJobHealth(jobId) {
  const job = jobData.findJob(jobId)
  if (!job) return null

  const disputesData = jobData.loadDisputes()
  const disputes = Array.isArray(disputesData) ? disputesData
    : (disputesData.disputes || [])

  const { score, penalties } = calculateHealth(job, disputes)
  const { tier, emoji, label } = getTier(score)
  return { jobId: job.id, client: job.client || job.clientName || 'Unknown', score, tier, emoji, label, penalties }
}

function getAllHealth() {
  const data = jobData.loadJobs()
  const jobs = data.jobs || data || []
  const disputesData = jobData.loadDisputes()
  const disputes = Array.isArray(disputesData) ? disputesData
    : (disputesData.disputes || [])

  const results = []
  for (const job of jobs) {
    // Skip paid/closed jobs
    const status = (job.status || '').toLowerCase()
    if (['paid', 'closed'].includes(status)) continue

    const { score, penalties } = calculateHealth(job, disputes)
    const { tier, emoji, label } = getTier(score)
    results.push({
      jobId: job.id,
      client: job.client || job.clientName || 'Unknown',
      score,
      tier,
      emoji,
      label,
      penalties
    })
  }

  // Sort by score ascending (worst first)
  results.sort((a, b) => a.score - b.score)
  return results
}

function getHealthSummary() {
  const all = getAllHealth()
  const counts = { red: 0, orange: 0, yellow: 0, green: 0 }
  let totalScore = 0

  for (const h of all) {
    counts[h.tier]++
    totalScore += h.score
  }

  const avg = all.length > 0 ? Math.round(totalScore / all.length) : 0
  return { ...counts, avg, total: all.length }
}

// ── Command Handlers ─────────────────────────────────────────────────

function handleHealthSummary() {
  const all = getAllHealth()
  if (!all.length) return '\uD83C\uDFE5 No active jobs to assess.'

  const tiers = {
    red: all.filter(h => h.tier === 'red'),
    orange: all.filter(h => h.tier === 'orange'),
    yellow: all.filter(h => h.tier === 'yellow'),
    green: all.filter(h => h.tier === 'green')
  }

  const totalScore = all.reduce((s, h) => s + h.score, 0)
  const avg = Math.round(totalScore / all.length)

  const lines = [
    '\uD83C\uDFE5 *Job Health Report*',
    '\u2501'.repeat(19),
    ''
  ]

  if (tiers.red.length) {
    lines.push(`\uD83D\uDD34 Red (${tiers.red.length} jobs) \u2014 CRITICAL`)
    for (const h of tiers.red.slice(0, 10)) {
      const issues = h.penalties.slice(0, 3).map(p => p.reason.split(' ').slice(0, 3).join(' ')).join(', ')
      lines.push(`\u2022 ${h.jobId} ${h.client} \u2014 ${h.score} pts (${issues})`)
    }
    if (tiers.red.length > 10) lines.push(`\u2022 +${tiers.red.length - 10} more`)
    lines.push('')
  }

  if (tiers.orange.length) {
    lines.push(`\uD83D\uDFE0 Orange (${tiers.orange.length} jobs)`)
    for (const h of tiers.orange.slice(0, 5)) {
      lines.push(`\u2022 ${h.jobId} ${h.client} \u2014 ${h.score} pts`)
    }
    if (tiers.orange.length > 5) lines.push(`\u2022 +${tiers.orange.length - 5} more`)
    lines.push('')
  }

  lines.push(`\uD83D\uDFE1 Yellow (${tiers.yellow.length} jobs)`)
  lines.push(`\uD83D\uDFE2 Green (${tiers.green.length} jobs)`)
  lines.push('')
  lines.push(`Average health: ${avg}/100`)

  return lines.join('\n')
}

function handleHealthDetail(jobId) {
  const health = getJobHealth(jobId)
  if (!health) return `\u274C Job ${jobId} not found`

  const lines = [
    `\uD83C\uDFE5 *Health: ${health.jobId} - ${health.client}*`,
    `Score: ${health.score}/100 ${health.emoji}`,
    ''
  ]

  if (health.penalties.length > 0) {
    lines.push('Penalties:')
    for (const p of health.penalties) {
      lines.push(`\u2022 ${p.points} ${p.reason}`)
    }
    lines.push('')
  } else {
    lines.push('No penalties \u2014 this job is healthy!')
    lines.push('')
  }

  // Build action recommendations
  const actions = []
  for (const p of health.penalties) {
    if (p.reason.includes('Lien deadline')) {
      const daysMatch = p.reason.match(/(\d+) days/)
      const days = daysMatch ? daysMatch[1] : '?'
      actions.push(`File lien or invoice immediately (${days} days left)`)
    }
    if (p.reason.includes('Missing address') || p.reason.includes('Missing adjuster') || p.reason.includes('Missing city')) {
      actions.push(`Add missing data (/audit fix ${health.jobId})`)
    }
    if (p.reason.includes('No invoice')) {
      actions.push(`Generate invoice (/scope ${health.jobId})`)
    }
  }
  // Deduplicate
  const uniqueActions = [...new Set(actions)]
  if (uniqueActions.length) {
    lines.push('Actions needed:')
    uniqueActions.forEach((a, i) => lines.push(`${i + 1}. ${a}`))
  }

  return lines.join('\n')
}

function handleHealthTier(tierName) {
  const all = getAllHealth()
  const filtered = all.filter(h => h.tier === tierName)

  if (!filtered.length) return `\uD83C\uDFE5 No ${tierName} tier jobs.`

  const tierInfo = getTier(tierName === 'red' ? 0 : tierName === 'orange' ? 50 : tierName === 'yellow' ? 70 : 90)
  const lines = [
    `\uD83C\uDFE5 *${tierInfo.emoji} ${tierInfo.label} Tier Jobs* (${filtered.length})`,
    '\u2501'.repeat(25),
    ''
  ]

  for (const h of filtered) {
    const topIssues = h.penalties.slice(0, 3).map(p => p.reason).join(', ')
    lines.push(`\u2022 ${h.jobId} ${h.client} \u2014 ${h.score} pts`)
    if (topIssues) lines.push(`  ${topIssues}`)
  }

  return lines.join('\n')
}

function handleHealthTop() {
  const all = getAllHealth()
  const top10 = all.slice(0, 10)

  if (!top10.length) return '\uD83C\uDFE5 No active jobs to assess.'

  const lines = [
    '\uD83C\uDFE5 *Top 10 Most Critical Jobs*',
    '\u2501'.repeat(25),
    ''
  ]

  for (const h of top10) {
    const topIssues = h.penalties.slice(0, 3).map(p => p.reason).join(', ')
    lines.push(`${h.emoji} ${h.jobId} ${h.client} \u2014 ${h.score}/100`)
    if (topIssues) lines.push(`  ${topIssues}`)
  }

  return lines.join('\n')
}

// ── Main Router ──────────────────────────────────────────────────────

async function handleHealth(text, gateway) {
  const body = text.replace(/^\/health\s*/i, '').trim()

  if (!body) return handleHealthSummary()
  if (body.toLowerCase() === 'red') return handleHealthTier('red')
  if (body.toLowerCase() === 'orange') return handleHealthTier('orange')
  if (body.toLowerCase() === 'yellow') return handleHealthTier('yellow')
  if (body.toLowerCase() === 'green') return handleHealthTier('green')
  if (body.toLowerCase() === 'top') return handleHealthTop()

  // Treat as job ID
  return handleHealthDetail(body)
}

// ── Daily Alert Cron (10:45 AM) ──────────────────────────────────────

function loadAlertState() {
  try {
    if (fs.existsSync(ALERT_STATE_FILE)) {
      return JSON.parse(fs.readFileSync(ALERT_STATE_FILE, 'utf-8'))
    }
  } catch { /* ignore */ }
  return { lastAlertDate: null, orangeJobIds: [] }
}

function saveAlertState(state) {
  const dir = path.dirname(ALERT_STATE_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(ALERT_STATE_FILE, JSON.stringify(state, null, 2))
}

function checkHealthAlerts(gateway) {
  const all = getAllHealth()
  const redJobs = all.filter(h => h.tier === 'red')
  const orangeJobs = all.filter(h => h.tier === 'orange')

  const state = loadAlertState()
  const prevOrangeIds = new Set(state.orangeJobIds || [])
  const newOrange = orangeJobs.filter(h => !prevOrangeIds.has(h.jobId))

  // Update state
  saveAlertState({
    lastAlertDate: new Date().toISOString().slice(0, 10),
    orangeJobIds: orangeJobs.map(h => h.jobId)
  })

  // Only alert if there are red jobs or new orange jobs
  if (!redJobs.length && !newOrange.length) return

  const lines = [
    '\uD83C\uDFE5 *Daily Health Alert*',
    '\u2501'.repeat(20),
    ''
  ]

  if (redJobs.length) {
    lines.push(`\uD83D\uDD34 *${redJobs.length} CRITICAL jobs:*`)
    for (const h of redJobs.slice(0, 10)) {
      const topIssue = h.penalties[0]?.reason || ''
      lines.push(`\u2022 ${h.jobId} ${h.client} \u2014 ${h.score} pts (${topIssue})`)
    }
    if (redJobs.length > 10) lines.push(`\u2022 +${redJobs.length - 10} more`)
    lines.push('')
  }

  if (newOrange.length) {
    lines.push(`\uD83D\uDFE0 *${newOrange.length} new warning jobs:*`)
    for (const h of newOrange.slice(0, 5)) {
      lines.push(`\u2022 ${h.jobId} ${h.client} \u2014 ${h.score} pts`)
    }
    if (newOrange.length > 5) lines.push(`\u2022 +${newOrange.length - 5} more`)
  }

  lines.push('')
  lines.push('Reply `/health` for full report or `/health FD-XXX` for details')

  const msg = lines.join('\n')
  const adapter = gateway.adapters.get('whatsapp')
  if (!adapter) {
    console.log('[HealthMonitor] No WhatsApp adapter for alert')
    return
  }

  adapter.sendMessage(FRANK_CHAT_ID, msg)
    .then(() => console.log('[HealthMonitor] Sent daily health alert'))
    .catch(err => console.error('[HealthMonitor] Alert send failed:', err.message))
}

function setupCron(gateway) {
  let lastAlertDate = null
  const timer = setInterval(() => {
    const now = new Date()
    const today = now.toISOString().slice(0, 10)
    if (now.getHours() === 10 && now.getMinutes() === 45 && lastAlertDate !== today) {
      lastAlertDate = today
      checkHealthAlerts(gateway)
    }
  }, 60000)
  gateway._healthAlertTimer = timer
}

// ── Register ─────────────────────────────────────────────────────────

export function register(gateway) {
  const originalExecute = gateway.commandHandler.execute.bind(gateway.commandHandler)

  gateway.commandHandler.execute = async function (text, sessionKey, adapter, chatId) {
    if (text.trim().toLowerCase().startsWith('/health')) {
      const response = await handleHealth(text.trim(), gateway)
      return { handled: true, response }
    }
    return originalExecute(text, sessionKey, adapter, chatId)
  }

  // Expose API for other features
  gateway._healthMonitor = {
    getJobHealth,
    getAllHealth,
    getHealthSummary
  }

  setupCron(gateway)
  console.log('[HealthMonitor] Feature loaded \u2014 /health commands, daily alert at 10:45 AM')
}
