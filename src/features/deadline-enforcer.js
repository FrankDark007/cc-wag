import fs from 'fs'

/**
 * Deadline Enforcer Feature
 * Protects Frank from losing money by alerting on:
 * - Uninvoiced completed jobs (7+ days)
 * - Lien deadlines approaching (30 days / 14 days critical)
 * - Overdue unpaid invoices (30+ days)
 *
 * Schedule: Every 4 hours during business hours (8am, 12pm, 4pm, 8pm)
 * Also sends a summary at 7:35 AM alongside the morning briefing.
 *
 * Reads from: /Users/ghost/Projects/cc-wag/workspace/jobs.json
 */

const JOBS_FILE = '/Users/ghost/Projects/cc-wag/workspace/jobs.json'
const FRANK_CHAT_ID = '17034981581@s.whatsapp.net'

// Check hours: 10:35 AM briefing + 12pm, 4pm, 8pm, 12am enforcement
// Frank works late (sleeps ~5am-10/11am)
const BRIEFING_HOUR = 10
const BRIEFING_MINUTE = 35
const ENFORCEMENT_HOURS = [12, 16, 20, 0]

// Thresholds (days)
const UNINVOICED_THRESHOLD = 7
const LIEN_WARNING_THRESHOLD = 30
const LIEN_CRITICAL_THRESHOLD = 14
const PAYMENT_OVERDUE_THRESHOLD = 30

const MS_PER_DAY = 86400000

/**
 * Load jobs from workspace/jobs.json
 * Returns empty array if file doesn't exist or is malformed
 */
function loadJobs() {
  try {
    if (!fs.existsSync(JOBS_FILE)) return []
    const raw = fs.readFileSync(JOBS_FILE, 'utf-8')
    const data = JSON.parse(raw)
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

/**
 * Calculate days between two dates (positive = past, negative = future)
 */
function daysBetween(dateStr, reference = new Date()) {
  const target = new Date(dateStr)
  if (isNaN(target.getTime())) return null
  return Math.floor((reference.getTime() - target.getTime()) / MS_PER_DAY)
}

/**
 * Format a dollar amount
 */
function fmtMoney(amount) {
  if (amount == null) return ''
  return `$${Number(amount).toLocaleString('en-US')}`
}

/**
 * Check for uninvoiced completed jobs (completed/needs-invoice, 7+ days ago)
 */
function checkUninvoiced(jobs) {
  const now = new Date()
  const hits = []

  for (const job of jobs) {
    const status = (job.status || '').toLowerCase()
    if (status !== 'completed' && status !== 'needs-invoice') continue

    const daysAgo = daysBetween(job.dateCompleted, now)
    if (daysAgo == null || daysAgo < UNINVOICED_THRESHOLD) continue

    hits.push({
      id: job.id || job.jobId || '???',
      name: job.clientName || job.client || 'Unknown',
      city: job.city || job.location || '',
      daysAgo
    })
  }

  // Sort most overdue first
  hits.sort((a, b) => b.daysAgo - a.daysAgo)
  return hits
}

/**
 * Check for lien deadlines approaching (within 30 days, not paid/closed)
 */
function checkLienDeadlines(jobs) {
  const now = new Date()
  const warnings = [] // 15-30 days
  const critical = [] // 0-14 days

  for (const job of jobs) {
    const status = (job.status || '').toLowerCase()
    if (status === 'paid' || status === 'closed') continue
    if (!job.lienDeadline) continue

    const daysUntil = -daysBetween(job.lienDeadline, now) // negative of daysBetween = days until
    if (daysUntil == null || daysUntil > LIEN_WARNING_THRESHOLD || daysUntil < 0) continue

    const entry = {
      id: job.id || job.jobId || '???',
      name: job.clientName || job.client || 'Unknown',
      city: job.city || job.location || '',
      amount: job.amount || job.invoiceAmount || null,
      daysUntil
    }

    if (daysUntil <= LIEN_CRITICAL_THRESHOLD) {
      critical.push(entry)
    } else {
      warnings.push(entry)
    }
  }

  // Sort by urgency (fewest days first)
  warnings.sort((a, b) => a.daysUntil - b.daysUntil)
  critical.sort((a, b) => a.daysUntil - b.daysUntil)

  return { warnings, critical }
}

/**
 * Check for overdue unpaid invoices (invoiced/payment-pending, 30+ days ago)
 */
function checkPaymentOverdue(jobs) {
  const now = new Date()
  const hits = []

  for (const job of jobs) {
    const status = (job.status || '').toLowerCase()
    if (status !== 'invoiced' && status !== 'payment-pending') continue

    const daysAgo = daysBetween(job.invoiceDate, now)
    if (daysAgo == null || daysAgo < PAYMENT_OVERDUE_THRESHOLD) continue

    hits.push({
      id: job.id || job.jobId || '???',
      name: job.clientName || job.client || 'Unknown',
      city: job.city || job.location || '',
      amount: job.amount || job.invoiceAmount || null,
      daysAgo
    })
  }

  hits.sort((a, b) => b.daysAgo - a.daysAgo)
  return hits
}

/**
 * Build all alert messages from current job data
 * Returns array of message strings
 */
function buildAlerts(jobs, alertedToday) {
  const messages = []
  const todayStr = new Date().toISOString().split('T')[0]

  // --- Critical lien deadlines (highest priority) ---
  const { warnings: lienWarnings, critical: lienCritical } = checkLienDeadlines(jobs)

  for (const job of lienCritical) {
    const key = `critical-lien:${job.id}:${todayStr}`
    if (alertedToday.has(key)) continue
    alertedToday.add(key)

    messages.push(
      `🚨 CRITICAL: ${job.id} ${job.name}` +
      ` — LIEN DEADLINE IN ${job.daysUntil} DAYS. File now or lose the right.`
    )
  }

  // --- Lien warnings (15-30 days) ---
  for (const job of lienWarnings) {
    const key = `lien-warning:${job.id}:${todayStr}`
    if (alertedToday.has(key)) continue
    alertedToday.add(key)

    const amountStr = job.amount ? ` — ${fmtMoney(job.amount)} unpaid` : ''
    messages.push(
      `⚠️ LIEN DEADLINE in ${job.daysUntil} days: ${job.id} ${job.name}` +
      (job.city ? ` (${job.city})` : '') +
      amountStr
    )
  }

  // --- Uninvoiced completed jobs ---
  const uninvoiced = checkUninvoiced(jobs)
  const uninvoicedNew = uninvoiced.filter(j => {
    const key = `uninvoiced:${j.id}:${todayStr}`
    if (alertedToday.has(key)) return false
    alertedToday.add(key)
    return true
  })

  if (uninvoicedNew.length > 0) {
    const lines = uninvoicedNew.map(j =>
      ` - ${j.id}: ${j.name}` +
      (j.city ? ` (${j.city})` : '') +
      ` — completed ${j.daysAgo} days ago`
    )
    messages.push(
      `🔴 ${uninvoicedNew.length} completed job${uninvoicedNew.length > 1 ? 's have' : ' has'} NO INVOICE after 7+ days:\n` +
      lines.join('\n')
    )
  }

  // --- Payment overdue ---
  const overdue = checkPaymentOverdue(jobs)
  const overdueNew = overdue.filter(j => {
    const key = `overdue:${j.id}:${todayStr}`
    if (alertedToday.has(key)) return false
    alertedToday.add(key)
    return true
  })

  if (overdueNew.length > 0) {
    const lines = overdueNew.map(j =>
      ` - ${j.id}: ${j.name}` +
      (j.city ? ` (${j.city})` : '') +
      (j.amount ? ` — ${fmtMoney(j.amount)}` : '') +
      ` invoiced ${j.daysAgo} days ago`
    )
    messages.push(
      `💰 ${overdueNew.length} invoice${overdueNew.length > 1 ? 's' : ''} unpaid after 30+ days:\n` +
      lines.join('\n')
    )
  }

  return messages
}

/**
 * Build a combined summary message (used for 7:35 AM briefing injection)
 */
function buildSummary(jobs) {
  const { warnings: lienWarnings, critical: lienCritical } = checkLienDeadlines(jobs)
  const uninvoiced = checkUninvoiced(jobs)
  const overdue = checkPaymentOverdue(jobs)

  const totalIssues = lienCritical.length + lienWarnings.length + uninvoiced.length + overdue.length
  if (totalIssues === 0) return null

  const parts = [`🔱 *Atlas Deadline Report*\n`]

  if (lienCritical.length > 0) {
    parts.push(`🚨 *CRITICAL LIEN DEADLINES:*`)
    for (const j of lienCritical) {
      parts.push(` - ${j.id} ${j.name} — ${j.daysUntil} DAYS LEFT`)
    }
    parts.push('')
  }

  if (lienWarnings.length > 0) {
    parts.push(`⚠️ *Lien Deadlines Approaching:*`)
    for (const j of lienWarnings) {
      const amountStr = j.amount ? ` (${fmtMoney(j.amount)})` : ''
      parts.push(` - ${j.id} ${j.name}${j.city ? ` (${j.city})` : ''} — ${j.daysUntil} days${amountStr}`)
    }
    parts.push('')
  }

  if (uninvoiced.length > 0) {
    parts.push(`🔴 *Uninvoiced Completed Jobs (${uninvoiced.length}):*`)
    for (const j of uninvoiced) {
      parts.push(` - ${j.id}: ${j.name}${j.city ? ` (${j.city})` : ''} — ${j.daysAgo} days`)
    }
    parts.push('')
  }

  if (overdue.length > 0) {
    parts.push(`💰 *Unpaid Invoices 30+ Days (${overdue.length}):*`)
    for (const j of overdue) {
      const amountStr = j.amount ? ` — ${fmtMoney(j.amount)}` : ''
      parts.push(` - ${j.id}: ${j.name}${j.city ? ` (${j.city})` : ''}${amountStr} — ${j.daysAgo} days`)
    }
    parts.push('')
  }

  parts.push(`_${totalIssues} item${totalIssues > 1 ? 's' : ''} need attention. Reply for details._`)

  return parts.join('\n')
}

/**
 * Send alerts via WhatsApp
 */
async function sendAlerts(gateway, messages) {
  const adapter = gateway.adapters.get('whatsapp')
  if (!adapter) {
    console.log('[DeadlineEnforcer] No WhatsApp adapter, skipping')
    return
  }

  for (const msg of messages) {
    try {
      await adapter.sendMessage(FRANK_CHAT_ID, msg)
    } catch (err) {
      console.error('[DeadlineEnforcer] Send failed:', err.message)
    }
  }
}

/**
 * Register the deadline enforcer feature
 */
export function register(gateway) {
  // Track alerts sent today to prevent spam (reset daily)
  const alertedToday = new Set()
  let lastAlertDate = null
  let lastBriefingDate = null

  const timer = setInterval(() => {
    const now = new Date()
    const todayStr = now.toISOString().split('T')[0]
    const hour = now.getHours()
    const minute = now.getMinutes()
    const day = now.getDay() // 0=Sun

    // Reset daily tracking
    if (lastAlertDate !== todayStr) {
      alertedToday.clear()
      lastAlertDate = todayStr
    }

    // Skip Sunday
    if (day === 0) return

    const jobs = loadJobs()
    if (jobs.length === 0) return

    // --- 7:35 AM: Send summary alongside morning briefing ---
    if (hour === BRIEFING_HOUR && minute === BRIEFING_MINUTE && lastBriefingDate !== todayStr) {
      lastBriefingDate = todayStr

      const summary = buildSummary(jobs)
      if (summary) {
        const adapter = gateway.adapters.get('whatsapp')
        if (adapter) {
          adapter.sendMessage(FRANK_CHAT_ID, summary)
            .then(() => console.log('[DeadlineEnforcer] Sent morning deadline summary'))
            .catch(err => console.error('[DeadlineEnforcer] Morning summary failed:', err.message))
        }
      }
      return // Don't double-send if 8am check also hits
    }

    // --- Enforcement checks: 8am, 12pm, 4pm, 8pm ---
    if (!ENFORCEMENT_HOURS.includes(hour) || minute !== 0) return

    // Check we haven't run this hour already
    const hourKey = `_run:${todayStr}:${hour}`
    if (alertedToday.has(hourKey)) return
    alertedToday.add(hourKey)

    const messages = buildAlerts(jobs, alertedToday)
    if (messages.length === 0) {
      console.log(`[DeadlineEnforcer] ${hour}:00 check — all clear`)
      return
    }

    console.log(`[DeadlineEnforcer] ${hour}:00 check — ${messages.length} alert(s)`)
    sendAlerts(gateway, messages)
  }, 60000) // Check every minute

  gateway._deadlineEnforcerTimer = timer

  console.log('[DeadlineEnforcer] Active — checks at 7:35am + every 4h (8/12/4/8), Mon-Sat')
}
