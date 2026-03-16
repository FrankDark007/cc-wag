import fs from 'fs'

/**
 * Data Integrator Feature
 * Wires together data from multiple sources into unified views.
 * Provides gateway.dataIntegrator for other features to call.
 *
 * Commands:
 *   /dashboard  - Combined dashboard view
 *
 * API (gateway.dataIntegrator):
 *   getDashboard()         - Combined revenue, jobs, liens, disputes
 *   getBriefingSections()  - Formatted sections for morning briefing
 *   getEnrichedJob(id)     - Job with all related data merged
 *
 * Reads from: workspace/jobs.json, workspace/disputes.json
 */

const WORKSPACE = '/Users/ghost/Projects/cc-wag/workspace'
const JOBS_FILE = `${WORKSPACE}/jobs.json`
const DISPUTES_FILE = `${WORKSPACE}/disputes.json`
const MS_PER_DAY = 86400000

// ── Shared utils with fallback ─────────────────────────────────────

let jobData
try {
  jobData = await import('../utils/job-data.js')
} catch {
  // Fallback: inline minimal versions
  jobData = {
    loadJobs() {
      try {
        if (!fs.existsSync(JOBS_FILE)) return []
        const raw = fs.readFileSync(JOBS_FILE, 'utf-8')
        const data = JSON.parse(raw)
        if (Array.isArray(data)) return data
        if (data && Array.isArray(data.jobs)) return data.jobs
        return []
      } catch {
        return []
      }
    },
    loadDisputes() {
      try {
        if (!fs.existsSync(DISPUTES_FILE)) return []
        const raw = fs.readFileSync(DISPUTES_FILE, 'utf-8')
        const data = JSON.parse(raw)
        if (Array.isArray(data)) return data
        if (data && Array.isArray(data.disputes)) return data.disputes
        return []
      } catch {
        return []
      }
    },
    findJob(id) {
      const jobs = this.loadJobs()
      const upper = id.toUpperCase()
      return jobs.find(j => {
        if (j.id === upper) return true
        const num = parseInt(id, 10)
        if (!isNaN(num) && j.id === `FD-${String(num).padStart(3, '0')}`) return true
        return false
      }) || null
    },
    formatDate(isoStr) {
      if (!isoStr) return '--'
      return new Date(isoStr).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
      })
    },
    formatMoneyDollars(dollars) {
      if (dollars == null || isNaN(dollars)) return '$0'
      return '$' + Number(dollars).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
    },
    daysUntil(isoStr) {
      if (!isoStr) return Infinity
      const d = new Date(isoStr)
      if (isNaN(d.getTime())) return Infinity
      return Math.ceil((d.getTime() - Date.now()) / MS_PER_DAY)
    },
    daysAgo(isoStr) {
      if (!isoStr) return null
      const d = new Date(isoStr)
      if (isNaN(d.getTime())) return null
      return Math.floor((Date.now() - d.getTime()) / MS_PER_DAY)
    },
    statusEmoji(status) {
      const s = (status || '').toLowerCase()
      if (s === 'paid') return '\u{1F7E2}'
      if (s === 'disputed') return '\u{1F534}'
      if (['invoiced', 'payment-pending'].includes(s)) return '\u{1F4E8}'
      if (s === 'needs-invoice') return '\u{1F4DD}'
      if (s === 'active') return '\u{1F535}'
      return '\u26AA'
    }
  }
}

// ── Disputes loader (creates empty file if missing) ────────────────

function loadDisputes() {
  try {
    if (jobData.loadDisputes) return jobData.loadDisputes()
  } catch { /* fall through */ }

  try {
    if (!fs.existsSync(DISPUTES_FILE)) {
      fs.writeFileSync(DISPUTES_FILE, JSON.stringify({ disputes: [] }, null, 2))
      return []
    }
    const raw = fs.readFileSync(DISPUTES_FILE, 'utf-8')
    const data = JSON.parse(raw)
    if (Array.isArray(data)) return data
    if (data && Array.isArray(data.disputes)) return data.disputes
    return []
  } catch {
    return []
  }
}

// ── Audit field scoring (mirrors job-auditor logic) ────────────────

const AUDIT_FIELDS = [
  { key: 'address',       weight: 15, check: v => typeof v === 'string' && v.trim().length > 0 },
  { key: 'city',          weight: 10, check: v => typeof v === 'string' && v.trim().length > 0 },
  { key: 'adjuster',      weight: 10, check: v => v != null && String(v).trim().length > 0 },
  { key: 'adjusterEmail', weight: 5,  check: v => v != null && String(v).trim().length > 0 },
  { key: 'invoiceAmount', weight: 10, check: v => v != null && Number(v) > 0 },
  { key: 'invoiceDate',   weight: 5,  check: v => v != null },
  { key: 'dateCompleted', weight: 5,  check: v => v != null },
  { key: 'driveFolderId', weight: 10, check: v => typeof v === 'string' && v.trim().length > 0 },
  { key: 'status',        weight: 5,  check: v => true } // simplified for integrator
]

const TOTAL_WEIGHT = AUDIT_FIELDS.reduce((sum, f) => sum + f.weight, 0)

function jobCompleteness(job) {
  let score = 0
  for (const field of AUDIT_FIELDS) {
    if (field.check(job[field.key])) score += field.weight
  }
  return Math.round((score / TOTAL_WEIGHT) * 100)
}

// ── Dashboard builder ──────────────────────────────────────────────

function buildDashboard() {
  const jobs = jobData.loadJobs()
  const disputes = loadDisputes()

  // Revenue
  let totalInvoiced = 0
  let totalPaid = 0
  let totalOutstanding = 0
  let totalDisputed = 0
  let paymentDaysSum = 0
  let paymentDaysCount = 0

  // Jobs by status
  const byStatus = {}

  // Liens
  let lienCritical = 0  // < 30 days
  let lienWarning = 0   // 30-60 days
  let lienSafe = 0      // 60+ days

  // Data quality
  let qualitySum = 0

  for (const job of jobs) {
    const status = (job.status || 'unknown').toLowerCase()
    byStatus[status] = (byStatus[status] || 0) + 1

    const amount = job.invoiceAmount || job.amount || 0

    // Revenue tracking
    if (amount > 0) totalInvoiced += amount

    if (status === 'paid') {
      totalPaid += amount
      // Calculate avg days to payment
      if (job.invoiceDate && job.paymentDate) {
        const days = jobData.daysAgo(job.invoiceDate) - jobData.daysAgo(job.paymentDate)
        if (!isNaN(days) && days >= 0) {
          paymentDaysSum += Math.abs(new Date(job.paymentDate) - new Date(job.invoiceDate)) / MS_PER_DAY
          paymentDaysCount++
        }
      }
    } else if (status === 'disputed') {
      totalDisputed += amount
    } else if (['invoiced', 'payment-pending'].includes(status) && amount > 0) {
      totalOutstanding += amount
    }

    // Lien tracking
    if (!['paid', 'closed', 'lien-filed'].includes(status) && job.lienDeadline) {
      const days = jobData.daysUntil(job.lienDeadline)
      if (days <= 30) lienCritical++
      else if (days <= 60) lienWarning++
      else lienSafe++
    }

    // Data quality
    qualitySum += jobCompleteness(job)
  }

  const avgDaysToPayment = paymentDaysCount > 0 ? Math.round(paymentDaysSum / paymentDaysCount) : 0

  // Disputes summary
  const openDisputes = disputes.filter(d => (d.status || '').toLowerCase() !== 'resolved')
  const disputeTotalAmount = disputes.reduce((sum, d) => sum + (d.amount || 0), 0)

  return {
    revenue: {
      totalInvoiced,
      totalPaid,
      totalOutstanding,
      totalDisputed,
      avgDaysToPayment
    },
    jobs: {
      total: jobs.length,
      byStatus,
      dataQuality: jobs.length > 0 ? Math.round(qualitySum / jobs.length) : 0
    },
    liens: {
      critical: lienCritical,
      warning: lienWarning,
      safe: lienSafe
    },
    disputes: {
      open: openDisputes.length,
      total: disputes.length,
      totalAmount: disputeTotalAmount
    }
  }
}

// ── Briefing sections builder ──────────────────────────────────────

function buildBriefingSections() {
  const jobs = jobData.loadJobs()
  const disputes = loadDisputes()
  const sections = []

  // Revenue section
  let totalInvoiced = 0
  let totalPaid = 0
  let totalOutstanding = 0

  for (const job of jobs) {
    const status = (job.status || '').toLowerCase()
    const amount = job.invoiceAmount || job.amount || 0
    if (amount > 0) totalInvoiced += amount
    if (status === 'paid') totalPaid += amount
    else if (['invoiced', 'payment-pending'].includes(status) && amount > 0) totalOutstanding += amount
  }

  sections.push({
    title: '\u{1F4B0} Revenue',
    body: `Invoiced: ${jobData.formatMoneyDollars(totalInvoiced)} | Paid: ${jobData.formatMoneyDollars(totalPaid)} | Outstanding: ${jobData.formatMoneyDollars(totalOutstanding)}`
  })

  // Critical liens section
  const criticalLiens = []
  for (const job of jobs) {
    const status = (job.status || '').toLowerCase()
    if (['paid', 'closed', 'lien-filed'].includes(status)) continue
    if (!job.lienDeadline) continue

    const days = jobData.daysUntil(job.lienDeadline)
    if (days <= 30 && days >= 0) {
      criticalLiens.push({ job, days })
    }
  }
  criticalLiens.sort((a, b) => a.days - b.days)

  if (criticalLiens.length > 0) {
    const lienLines = criticalLiens.slice(0, 5).map(({ job, days }) => {
      const client = job.client || 'Unknown'
      return `\u2022 ${job.id} - ${client} (${days} days)`
    })
    if (criticalLiens.length > 5) {
      lienLines.push(`\u2022 +${criticalLiens.length - 5} more`)
    }
    sections.push({
      title: '\u{1F534} Critical Liens',
      body: `${criticalLiens.length} job${criticalLiens.length > 1 ? 's' : ''} within 30 days of lien deadline:\n${lienLines.join('\n')}`
    })
  }

  // Disputes section
  const openDisputes = disputes.filter(d => (d.status || '').toLowerCase() !== 'resolved')
  if (openDisputes.length > 0) {
    const disputeTotal = openDisputes.reduce((sum, d) => sum + (d.amount || 0), 0)
    const disputeLines = openDisputes.slice(0, 5).map(d => {
      const jobId = d.jobId || '???'
      const reason = d.reason || 'Unknown'
      const amt = d.amount ? ` (${jobData.formatMoneyDollars(d.amount)})` : ''
      return `\u2022 ${jobId} - ${reason}${amt}`
    })
    sections.push({
      title: '\u26A0\uFE0F Disputes',
      body: `${openDisputes.length} open dispute${openDisputes.length > 1 ? 's' : ''} (${jobData.formatMoneyDollars(disputeTotal)} total):\n${disputeLines.join('\n')}`
    })
  }

  // Data quality section
  let qualitySum = 0
  let missingAddress = 0
  let missingAdjuster = 0

  for (const job of jobs) {
    qualitySum += jobCompleteness(job)
    if (!job.address || !job.address.trim()) missingAddress++
    if (!job.adjuster) missingAdjuster++
  }

  const overallQuality = jobs.length > 0 ? Math.round(qualitySum / jobs.length) : 0
  const qualityParts = []
  if (missingAddress > 0) qualityParts.push(`${missingAddress} jobs missing address`)
  if (missingAdjuster > 0) qualityParts.push(`${missingAdjuster} missing adjuster`)
  const qualityDetail = qualityParts.length > 0 ? ` \u2014 ${qualityParts.join(', ')}` : ''

  sections.push({
    title: '\u{1F4CA} Data Quality',
    body: `${overallQuality}% complete${qualityDetail}`
  })

  return sections
}

// ── Enriched job builder ───────────────────────────────────────────

function enrichJob(jobId) {
  const job = jobData.findJob(jobId)
  if (!job) return null

  const disputes = loadDisputes()
  const jobDisputes = disputes.filter(d =>
    d.jobId === job.id || d.jobId === jobId
  )

  // Lien info
  let lienDaysLeft = null
  let lienUrgency = 'safe'
  if (job.lienDeadline) {
    lienDaysLeft = jobData.daysUntil(job.lienDeadline)
    if (lienDaysLeft <= 14) lienUrgency = 'critical'
    else if (lienDaysLeft <= 30) lienUrgency = 'warning'
    else lienUrgency = 'safe'
  }

  // Recent notes (last 5)
  const notes = Array.isArray(job.notes) ? job.notes : []
  const recentNotes = notes.slice(-5)

  // Data completeness
  const dataCompleteness = jobCompleteness(job)

  return {
    ...job,
    lienDaysLeft,
    lienUrgency,
    disputes: jobDisputes,
    recentNotes,
    dataCompleteness
  }
}

// ── Dashboard formatting ───────────────────────────────────────────

function formatDashboard(dashboard) {
  const { revenue, jobs, liens, disputes } = dashboard

  const lines = [
    '\u{1F4CA} *Atlas Dashboard*',
    '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501',
    '',
    '*\u{1F4B0} Revenue*',
    `  Invoiced: ${jobData.formatMoneyDollars(revenue.totalInvoiced)}`,
    `  \u{1F7E2} Paid: ${jobData.formatMoneyDollars(revenue.totalPaid)}`,
    `  \u{1F7E1} Outstanding: ${jobData.formatMoneyDollars(revenue.totalOutstanding)}`,
    `  \u{1F534} Disputed: ${jobData.formatMoneyDollars(revenue.totalDisputed)}`,
  ]

  if (revenue.avgDaysToPayment > 0) {
    lines.push(`  Avg days to payment: ${revenue.avgDaysToPayment}`)
  }

  lines.push('')
  lines.push(`*\u{1F4C1} Jobs* (${jobs.total} total)`)
  const statusMap = {
    active: '\u{1F535} Active',
    'needs-invoice': '\u{1F4DD} Needs Invoice',
    invoiced: '\u{1F4E8} Invoiced',
    'payment-pending': '\u23F3 Payment Pending',
    paid: '\u{1F7E2} Paid',
    disputed: '\u{1F534} Disputed',
    'lien-filed': '\u2696\uFE0F Lien Filed',
    completed: '\u2705 Completed'
  }
  for (const [status, count] of Object.entries(jobs.byStatus)) {
    const label = statusMap[status] || `\u26AA ${status}`
    lines.push(`  ${label}: ${count}`)
  }
  lines.push(`  Data quality: ${jobs.dataQuality}%`)

  lines.push('')
  lines.push('*\u2696\uFE0F Lien Deadlines*')
  lines.push(`  \u{1F534} Critical (<30d): ${liens.critical}`)
  lines.push(`  \u{1F7E1} Warning (30-60d): ${liens.warning}`)
  lines.push(`  \u{1F7E2} Safe (60d+): ${liens.safe}`)

  if (disputes.total > 0 || disputes.open > 0) {
    lines.push('')
    lines.push('*\u26A0\uFE0F Disputes*')
    lines.push(`  Open: ${disputes.open}`)
    lines.push(`  Total: ${disputes.total}`)
    if (disputes.totalAmount > 0) {
      lines.push(`  Amount: ${jobData.formatMoneyDollars(disputes.totalAmount)}`)
    }
  }

  lines.push('')
  lines.push('_Use /revenue, /liens, /audit for detailed views_')

  return lines.join('\n')
}

// ── Plugin Registration ────────────────────────────────────────────

export function register(gateway) {
  // Expose the data integrator API on the gateway
  gateway.dataIntegrator = {
    getDashboard: () => buildDashboard(),
    getBriefingSections: () => buildBriefingSections(),
    getEnrichedJob: (id) => enrichJob(id),
  }

  // Register /dashboard command
  const originalExecute = gateway.commandHandler.execute.bind(gateway.commandHandler)

  gateway.commandHandler.execute = async function (text, sessionKey, adapter, chatId) {
    const lower = text.trim().toLowerCase()

    if (lower === '/dashboard' || lower === '/dash') {
      try {
        const dashboard = buildDashboard()
        return { handled: true, response: formatDashboard(dashboard) }
      } catch (err) {
        return { handled: true, response: `Dashboard error: ${err.message}` }
      }
    }

    return originalExecute(text, sessionKey, adapter, chatId)
  }

  // Extend /help
  if (gateway.commandHandler.handleHelp) {
    const originalHelp = gateway.commandHandler.handleHelp.bind(gateway.commandHandler)
    gateway.commandHandler.handleHelp = function () {
      const result = originalHelp()
      const dashLines = [
        '',
        '--- Dashboard ---',
        '/dashboard \u2014 combined data dashboard',
      ]
      result.response += '\n' + dashLines.join('\n')
      return result
    }
  }

  // Create disputes.json if it doesn't exist
  if (!fs.existsSync(DISPUTES_FILE)) {
    try {
      fs.writeFileSync(DISPUTES_FILE, JSON.stringify({ disputes: [] }, null, 2))
      console.log('[DataIntegrator] Created empty disputes.json')
    } catch (err) {
      console.warn('[DataIntegrator] Could not create disputes.json:', err.message)
    }
  }

  console.log('[DataIntegrator] Feature loaded \u2014 gateway.dataIntegrator available, /dashboard enabled')
}
