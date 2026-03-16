import fs from 'fs'

/**
 * Revenue Dashboard Feature
 * Real-time financial visibility across all jobs
 *
 * Commands:
 *   /revenue              — total invoiced, collected, outstanding, disputed
 *   /revenue month        — this month's numbers
 *   /revenue aging        — 0-30, 30-60, 60-90, 90+ days outstanding
 *   /revenue adjuster     — breakdown by insurance company / adjuster
 *
 * Reads from: /Users/ghost/Projects/cc-wag/workspace/jobs.json
 * Emoji indicators: 🟢 paid, 🟡 pending, 🔴 overdue
 */

const JOBS_FILE = '/Users/ghost/Projects/cc-wag/workspace/jobs.json'
const MS_PER_DAY = 86400000

// ── Storage ─────────────────────────────────────────────────────────

function loadJobs() {
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
}

// ── Helpers ─────────────────────────────────────────────────────────

function fmtMoney(amount) {
  if (amount == null || isNaN(amount)) return '$0.00'
  return '$' + Number(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

function daysSince(isoStr) {
  if (!isoStr) return null
  const d = new Date(isoStr)
  if (isNaN(d.getTime())) return null
  return Math.floor((Date.now() - d.getTime()) / MS_PER_DAY)
}

function isThisMonth(isoStr) {
  if (!isoStr) return false
  const d = new Date(isoStr)
  const now = new Date()
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
}

function statusEmoji(status) {
  if (status === 'paid') return '🟢'
  if (status === 'disputed') return '🔴'
  if (['invoiced', 'payment-pending', 'needs-invoice'].includes(status)) return '🟡'
  return '⚪'
}

// ── Revenue Overview ────────────────────────────────────────────────

function handleRevenueOverview(jobs) {
  let totalInvoiced = 0
  let totalCollected = 0
  let totalOutstanding = 0
  let totalDisputed = 0
  let invoicedCount = 0
  let paidCount = 0
  let outstandingCount = 0
  let disputedCount = 0
  let uninvoicedCount = 0

  for (const j of jobs) {
    const status = (j.status || '').toLowerCase()
    const amount = j.invoiceAmount || j.amount || 0

    if (amount > 0) {
      totalInvoiced += amount
      invoicedCount++
    }

    if (status === 'paid') {
      totalCollected += amount
      paidCount++
    } else if (status === 'disputed') {
      totalDisputed += amount
      disputedCount++
    } else if (['invoiced', 'payment-pending'].includes(status) && amount > 0) {
      totalOutstanding += amount
      outstandingCount++
    }

    if (['active', 'completed', 'needs-invoice'].includes(status)) {
      uninvoicedCount++
    }
  }

  const collectionRate = totalInvoiced > 0
    ? Math.round((totalCollected / totalInvoiced) * 100)
    : 0

  const lines = [
    '💰 *Revenue Dashboard*',
    '',
    `Total Invoiced: ${fmtMoney(totalInvoiced)} (${invoicedCount} jobs)`,
    `🟢 Collected: ${fmtMoney(totalCollected)} (${paidCount} jobs)`,
    `🟡 Outstanding: ${fmtMoney(totalOutstanding)} (${outstandingCount} jobs)`,
    `🔴 Disputed: ${fmtMoney(totalDisputed)} (${disputedCount} jobs)`,
    '',
    `Collection rate: ${collectionRate}%`,
    `Uninvoiced jobs: ${uninvoicedCount}`,
    `Total tracked: ${jobs.length} jobs`,
  ]

  if (uninvoicedCount > 0) {
    lines.push('')
    lines.push(`⚠️ ${uninvoicedCount} jobs still need invoicing`)
  }

  return { handled: true, response: lines.join('\n') }
}

// ── Revenue This Month ──────────────────────────────────────────────

function handleRevenueMonth(jobs) {
  const now = new Date()
  const monthName = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  let invoicedThisMonth = 0
  let collectedThisMonth = 0
  let invoicedCount = 0
  let paidCount = 0
  const recentJobs = []

  for (const j of jobs) {
    const status = (j.status || '').toLowerCase()
    const amount = j.invoiceAmount || j.amount || 0

    // Invoiced this month
    if (amount > 0 && isThisMonth(j.invoiceDate)) {
      invoicedThisMonth += amount
      invoicedCount++
      recentJobs.push(j)
    }

    // Paid this month
    if (status === 'paid' && amount > 0 && isThisMonth(j.paymentDate)) {
      collectedThisMonth += amount
      paidCount++
      if (!recentJobs.includes(j)) recentJobs.push(j)
    }
  }

  const lines = [
    `📅 *Revenue — ${monthName}*`,
    '',
    `Invoiced: ${fmtMoney(invoicedThisMonth)} (${invoicedCount} jobs)`,
    `Collected: ${fmtMoney(collectedThisMonth)} (${paidCount} payments)`,
    `Net outstanding: ${fmtMoney(invoicedThisMonth - collectedThisMonth)}`,
  ]

  if (recentJobs.length > 0) {
    lines.push('')
    lines.push('Recent activity:')
    for (const j of recentJobs.slice(0, 10)) {
      const amount = j.invoiceAmount || j.amount || 0
      const emoji = statusEmoji(j.status)
      const client = j.client || j.clientName || 'Unknown'
      lines.push(`${emoji} ${j.id} ${client} — ${fmtMoney(amount)}`)
    }
  } else {
    lines.push('')
    lines.push('No invoicing activity this month yet.')
  }

  return { handled: true, response: lines.join('\n') }
}

// ── Aging Report ────────────────────────────────────────────────────

function handleRevenueAging(jobs) {
  const buckets = {
    '0-30': { jobs: [], total: 0 },
    '30-60': { jobs: [], total: 0 },
    '60-90': { jobs: [], total: 0 },
    '90+': { jobs: [], total: 0 }
  }

  let grandTotal = 0

  for (const j of jobs) {
    const status = (j.status || '').toLowerCase()
    if (!['invoiced', 'payment-pending', 'disputed'].includes(status)) continue

    const amount = j.invoiceAmount || j.amount || 0
    if (amount <= 0) continue

    const days = daysSince(j.invoiceDate)
    if (days == null) continue

    let bucket
    if (days <= 30) bucket = '0-30'
    else if (days <= 60) bucket = '30-60'
    else if (days <= 90) bucket = '60-90'
    else bucket = '90+'

    buckets[bucket].jobs.push({ ...j, ageDays: days })
    buckets[bucket].total += amount
    grandTotal += amount
  }

  const lines = [
    '📊 *Accounts Receivable Aging*',
    ''
  ]

  for (const [range, data] of Object.entries(buckets)) {
    const pct = grandTotal > 0 ? Math.round((data.total / grandTotal) * 100) : 0
    const bar = range === '90+' ? '🔴' : range === '60-90' ? '🟠' : range === '30-60' ? '🟡' : '🟢'

    lines.push(`${bar} *${range} days:* ${fmtMoney(data.total)} (${data.jobs.length} jobs, ${pct}%)`)

    // Show individual jobs for 60+ day buckets
    if (['60-90', '90+'].includes(range) && data.jobs.length > 0) {
      for (const j of data.jobs.slice(0, 5)) {
        const client = j.client || j.clientName || 'Unknown'
        lines.push(`   ${j.id} ${client} — ${fmtMoney(j.invoiceAmount || j.amount)} (${j.ageDays}d)`)
      }
      if (data.jobs.length > 5) {
        lines.push(`   ... +${data.jobs.length - 5} more`)
      }
    }
  }

  lines.push('')
  lines.push(`*Total outstanding: ${fmtMoney(grandTotal)}*`)

  if (buckets['90+'].jobs.length > 0) {
    lines.push('')
    lines.push(`⚠️ ${buckets['90+'].jobs.length} invoices over 90 days — lien/collection risk`)
  }

  return { handled: true, response: lines.join('\n') }
}

// ── Revenue by Adjuster / Insurance ─────────────────────────────────

function handleRevenueAdjuster(jobs) {
  const adjusters = {}

  for (const j of jobs) {
    const amount = j.invoiceAmount || j.amount || 0
    const adjName = j.adjuster || j.insuranceCompany || 'Unassigned'

    if (!adjusters[adjName]) {
      adjusters[adjName] = {
        invoiced: 0,
        collected: 0,
        disputed: 0,
        outstanding: 0,
        jobCount: 0,
        email: j.adjusterEmail || null
      }
    }

    const a = adjusters[adjName]
    a.jobCount++

    if (amount > 0) a.invoiced += amount

    const status = (j.status || '').toLowerCase()
    if (status === 'paid') a.collected += amount
    else if (status === 'disputed') a.disputed += amount
    else if (['invoiced', 'payment-pending'].includes(status)) a.outstanding += amount
  }

  // Sort by total invoiced descending
  const sorted = Object.entries(adjusters)
    .sort(([, a], [, b]) => b.invoiced - a.invoiced)

  const lines = [
    '🏢 *Revenue by Adjuster / Insurance*',
    ''
  ]

  for (const [name, data] of sorted) {
    if (data.invoiced === 0 && name === 'Unassigned') {
      // Show unassigned count but skip detail if $0
      lines.push(`⚪ *${name}* — ${data.jobCount} jobs (no invoices yet)`)
      continue
    }

    const collPct = data.invoiced > 0 ? Math.round((data.collected / data.invoiced) * 100) : 0
    lines.push(`*${name}* (${data.jobCount} jobs)`)
    lines.push(`  Invoiced: ${fmtMoney(data.invoiced)}`)
    if (data.collected > 0) lines.push(`  🟢 Collected: ${fmtMoney(data.collected)} (${collPct}%)`)
    if (data.outstanding > 0) lines.push(`  🟡 Outstanding: ${fmtMoney(data.outstanding)}`)
    if (data.disputed > 0) lines.push(`  🔴 Disputed: ${fmtMoney(data.disputed)}`)
    lines.push('')
  }

  return { handled: true, response: lines.join('\n').trim() }
}

// ── Command Router ──────────────────────────────────────────────────

function routeRevenueCommand(text) {
  const trimmed = text.trim()
  const lower = trimmed.toLowerCase()

  if (!lower.startsWith('/revenue')) return null

  const rest = lower.slice(8).trim()
  const jobs = loadJobs()

  if (jobs.length === 0) {
    return { handled: true, response: 'No jobs tracked yet. Revenue dashboard needs jobs in workspace/jobs.json.' }
  }

  if (!rest) return handleRevenueOverview(jobs)
  if (rest === 'month') return handleRevenueMonth(jobs)
  if (rest === 'aging') return handleRevenueAging(jobs)
  if (rest === 'adjuster' || rest === 'adjusters' || rest === 'insurance') return handleRevenueAdjuster(jobs)

  return {
    handled: true,
    response: [
      '*Revenue Dashboard Commands*',
      '',
      '/revenue — overview (invoiced, collected, outstanding, disputed)',
      '/revenue month — this month\'s numbers',
      '/revenue aging — 0-30, 30-60, 60-90, 90+ days',
      '/revenue adjuster — breakdown by adjuster/insurance'
    ].join('\n')
  }
}

// ── Plugin Registration ─────────────────────────────────────────────

export function register(gateway) {
  const originalExecute = gateway.commandHandler.execute.bind(gateway.commandHandler)

  gateway.commandHandler.execute = async function (text, sessionKey, adapter, chatId) {
    const lower = text.trim().toLowerCase()

    if (lower.startsWith('/revenue')) {
      const result = routeRevenueCommand(text)
      if (result) return result
    }

    return originalExecute(text, sessionKey, adapter, chatId)
  }

  // Extend /help
  const originalHelp = gateway.commandHandler.handleHelp.bind(gateway.commandHandler)
  gateway.commandHandler.handleHelp = function () {
    const result = originalHelp()
    const revenueLines = [
      '',
      '--- Revenue Dashboard ---',
      '/revenue — financial overview',
      '/revenue month — this month',
      '/revenue aging — outstanding aging report',
      '/revenue adjuster — by adjuster/insurance'
    ]
    result.response += '\n' + revenueLines.join('\n')
    return result
  }

  console.log('[RevenueDashboard] Loaded — /revenue commands enabled')
}
