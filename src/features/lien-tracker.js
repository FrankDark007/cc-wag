import fs from 'fs'
import config from '../config.js'

/**
 * Lien & Legal Tracker Feature
 * Tracks lien filing deadlines, demand letters, legal escalation
 *
 * Commands:
 *   /liens              — all jobs approaching lien deadline
 *   /liens critical      — within 14 days
 *   /lien FD-002 filed   — mark lien as filed
 *   /lien FD-002 demand  — draft a demand letter
 *
 * Cron: Daily 10:35 AM, alert on deadlines within 14 days
 * Reads from: workspace/jobs.json
 */

const JOBS_FILE = config.paths.jobsFile
const FRANK_CHAT_ID = '17034981581@s.whatsapp.net'
const MS_PER_DAY = 86400000

// ── Storage ─────────────────────────────────────────────────────────

function loadJobsData() {
  try {
    if (!fs.existsSync(JOBS_FILE)) return { nextId: 1, jobs: [] }
    const raw = fs.readFileSync(JOBS_FILE, 'utf-8')
    const data = JSON.parse(raw)
    if (Array.isArray(data)) return { nextId: data.length + 1, jobs: data }
    return data
  } catch {
    return { nextId: 1, jobs: [] }
  }
}

function saveJobsData(data) {
  fs.writeFileSync(JOBS_FILE, JSON.stringify(data, null, 2))
}

// ── Helpers ─────────────────────────────────────────────────────────

function daysUntil(isoStr) {
  if (!isoStr) return Infinity
  const d = new Date(isoStr)
  if (isNaN(d.getTime())) return Infinity
  return Math.ceil((d.getTime() - Date.now()) / MS_PER_DAY)
}

function formatDate(isoStr) {
  if (!isoStr) return '—'
  return new Date(isoStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
  })
}

function fmtMoney(amount) {
  if (amount == null || isNaN(amount)) return '—'
  return '$' + Number(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

function findJob(jobs, idStr) {
  const upper = idStr.toUpperCase()
  return jobs.find(j => {
    if (j.id === upper) return true
    const num = parseInt(idStr, 10)
    if (!isNaN(num) && j.id === `FD-${String(num).padStart(3, '0')}`) return true
    return false
  })
}

function urgencyEmoji(days) {
  if (days <= 7) return '🚨'
  if (days <= 14) return '🔴'
  if (days <= 21) return '🟠'
  if (days <= 30) return '🟡'
  return '⚪'
}

// ── Lien-eligible jobs (not paid/closed/lien-filed) ─────────────────

function getLienJobs(jobs) {
  return jobs
    .filter(j => {
      const status = (j.status || '').toLowerCase()
      if (['paid', 'closed', 'lien-filed'].includes(status)) return false
      if (!j.lienDeadline) return false
      return true
    })
    .map(j => ({
      ...j,
      daysLeft: daysUntil(j.lienDeadline)
    }))
    .filter(j => j.daysLeft < 120) // only show reasonably approaching deadlines
    .sort((a, b) => a.daysLeft - b.daysLeft)
}

// ── /liens — all approaching ────────────────────────────────────────

function handleLiens(jobs) {
  const lienJobs = getLienJobs(jobs)

  if (lienJobs.length === 0) {
    return { handled: true, response: 'No jobs approaching lien deadlines right now.' }
  }

  const critical = lienJobs.filter(j => j.daysLeft <= 14)
  const warning = lienJobs.filter(j => j.daysLeft > 14 && j.daysLeft <= 30)
  const upcoming = lienJobs.filter(j => j.daysLeft > 30)

  const lines = [
    `⚖️ *Lien Deadline Tracker* (${lienJobs.length} jobs)`,
    ''
  ]

  if (critical.length > 0) {
    lines.push(`🚨 *CRITICAL — within 14 days (${critical.length}):*`)
    for (const j of critical) {
      const client = j.client || j.clientName || 'Unknown'
      const amount = fmtMoney(j.invoiceAmount || j.amount)
      lines.push(`  ${urgencyEmoji(j.daysLeft)} ${j.id} ${client} — ${j.daysLeft}d left (${formatDate(j.lienDeadline)}) ${amount}`)
    }
    lines.push('')
  }

  if (warning.length > 0) {
    lines.push(`🟡 *Warning — 15-30 days (${warning.length}):*`)
    for (const j of warning) {
      const client = j.client || j.clientName || 'Unknown'
      const amount = fmtMoney(j.invoiceAmount || j.amount)
      lines.push(`  ${j.id} ${client} — ${j.daysLeft}d (${formatDate(j.lienDeadline)}) ${amount}`)
    }
    lines.push('')
  }

  if (upcoming.length > 0) {
    lines.push(`⚪ *Upcoming — 30+ days (${upcoming.length}):*`)
    for (const j of upcoming.slice(0, 10)) {
      const client = j.client || j.clientName || 'Unknown'
      lines.push(`  ${j.id} ${client} — ${j.daysLeft}d (${formatDate(j.lienDeadline)})`)
    }
    if (upcoming.length > 10) {
      lines.push(`  ... +${upcoming.length - 10} more`)
    }
    lines.push('')
  }

  lines.push('Use /lien <id> filed to mark a lien as filed')
  lines.push('Use /lien <id> demand to draft a demand letter')

  return { handled: true, response: lines.join('\n') }
}

// ── /liens critical — within 14 days ────────────────────────────────

function handleLiensCritical(jobs) {
  const critical = getLienJobs(jobs).filter(j => j.daysLeft <= 14)

  if (critical.length === 0) {
    return { handled: true, response: '✅ No lien deadlines within 14 days.' }
  }

  const lines = [
    `🚨 *CRITICAL LIEN DEADLINES* (${critical.length} jobs within 14 days)`,
    ''
  ]

  for (const j of critical) {
    const client = j.client || j.clientName || 'Unknown'
    const amount = fmtMoney(j.invoiceAmount || j.amount)
    const city = j.city ? ` (${j.city})` : ''
    const adjuster = j.adjuster ? ` | Adj: ${j.adjuster}` : ''

    lines.push(`${urgencyEmoji(j.daysLeft)} *${j.id} ${client}*${city}`)
    lines.push(`   Deadline: ${formatDate(j.lienDeadline)} (${j.daysLeft} days)`)
    lines.push(`   Amount: ${amount}${adjuster}`)
    lines.push(`   Status: ${j.status}`)

    if (j.daysLeft <= 7) {
      lines.push(`   ⚠️ FILE LIEN NOW or lose the right`)
    }
    lines.push('')
  }

  lines.push('Reply /lien <id> filed to mark as filed')
  lines.push('Reply /lien <id> demand to draft demand letter')

  return { handled: true, response: lines.join('\n') }
}

// ── /lien <id> filed — mark lien as filed ───────────────────────────

function handleLienFiled(job, data) {
  const oldStatus = job.status
  job.status = 'lien-filed'

  if (!Array.isArray(job.notes)) job.notes = []
  job.notes.push({
    text: `Lien marked as filed (was: ${oldStatus})`,
    date: new Date().toISOString()
  })

  // Store lien filing date
  job.lienFiledDate = new Date().toISOString()

  saveJobsData(data)

  const client = job.client || job.clientName || 'Unknown'
  const amount = fmtMoney(job.invoiceAmount || job.amount)

  return {
    handled: true,
    response: [
      `⚖️ *${job.id}* — Lien marked as FILED`,
      '',
      `Client: ${client}`,
      `Amount: ${amount}`,
      `Filed: ${formatDate(job.lienFiledDate)}`,
      `Previous status: ${oldStatus}`,
      '',
      'Next steps: follow up with demand letter or attorney.'
    ].join('\n')
  }
}

// ── /lien <id> demand — draft demand letter ─────────────────────────

function handleLienDemand(job) {
  const client = job.client || job.clientName || 'Unknown'
  const address = job.address || '[ADDRESS]'
  const city = job.city || '[CITY]'
  const amount = job.invoiceAmount || job.amount || 0
  const amountStr = fmtMoney(amount)
  const adjuster = job.adjuster || '[ADJUSTER NAME]'
  const adjusterEmail = job.adjusterEmail || '[ADJUSTER EMAIL]'
  const today = new Date().toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric'
  })
  const lienDeadline = formatDate(job.lienDeadline)

  const letter = [
    `📄 *DEMAND LETTER DRAFT — ${job.id}*`,
    '',
    '---',
    '',
    `Date: ${today}`,
    '',
    `RE: ${client}`,
    `Property: ${address}, ${city}`,
    `Claim Amount: ${amountStr}`,
    '',
    `Dear ${adjuster},`,
    '',
    `This letter serves as formal demand for payment of ${amountStr} for water damage restoration services performed at the above-referenced property for ${client}.`,
    '',
    `Flood Doctor LLC completed all restoration work as authorized and has submitted proper documentation including scope of work, moisture readings, equipment logs, and photographic evidence.`,
    '',
    `Payment has not been received despite multiple follow-ups. The lien deadline for this property is ${lienDeadline}.`,
    '',
    `Please remit payment of ${amountStr} within 10 business days of this notice. Failure to do so will result in:`,
    '',
    `1. Filing of a mechanic's lien against the property`,
    `2. Referral to legal counsel for collection`,
    `3. Reporting to the Virginia Department of Insurance`,
    '',
    `Please direct payment or inquiries to:`,
    `Frank Darakhshan, President`,
    `Flood Doctor LLC`,
    `frank@flood.doctor`,
    '',
    '---',
    '',
    `⚠️ This is a DRAFT. Review and customize before sending to ${adjuster}${adjusterEmail !== '[ADJUSTER EMAIL]' ? ` (${adjusterEmail})` : ''}.`
  ]

  return { handled: true, response: letter.join('\n') }
}

// ── Command Router ──────────────────────────────────────────────────

function routeLienCommand(text) {
  const trimmed = text.trim()
  const lower = trimmed.toLowerCase()

  // /liens commands
  if (lower === '/liens') {
    const jobs = loadJobsData().jobs
    return handleLiens(jobs)
  }

  if (lower === '/liens critical') {
    const jobs = loadJobsData().jobs
    return handleLiensCritical(jobs)
  }

  // /lien <id> <action>
  if (!lower.startsWith('/lien ')) return null

  const rest = trimmed.slice(6).trim()
  const parts = rest.split(/\s+/)

  if (parts.length < 2) {
    return {
      handled: true,
      response: [
        '*Lien Tracker Commands*',
        '',
        '/liens — all jobs approaching lien deadline',
        '/liens critical — within 14 days',
        '/lien <id> filed — mark lien as filed',
        '/lien <id> demand — draft demand letter'
      ].join('\n')
    }
  }

  const idStr = parts[0]
  const action = parts[1].toLowerCase()

  const data = loadJobsData()
  const job = findJob(data.jobs, idStr)

  if (!job) {
    return { handled: true, response: `Job not found: ${idStr}` }
  }

  if (action === 'filed') return handleLienFiled(job, data)
  if (action === 'demand') return handleLienDemand(job)

  return {
    handled: true,
    response: `Unknown lien action: ${action}. Use "filed" or "demand".`
  }
}

// ── Daily Cron Alert ────────────────────────────────────────────────

function runDailyLienCheck(gateway) {
  const jobs = loadJobsData().jobs
  const critical = getLienJobs(jobs).filter(j => j.daysLeft <= 14)

  if (critical.length === 0) {
    console.log('[LienTracker] Daily check — no critical deadlines')
    return
  }

  const lines = [
    `⚖️ *Lien Alert* — ${critical.length} deadline${critical.length > 1 ? 's' : ''} within 14 days:`,
    ''
  ]

  for (const j of critical) {
    const client = j.client || j.clientName || 'Unknown'
    const amount = fmtMoney(j.invoiceAmount || j.amount)
    lines.push(`${urgencyEmoji(j.daysLeft)} ${j.id} ${client} — ${j.daysLeft}d left ${amount}`)
  }

  lines.push('')
  lines.push('Reply /liens critical for details')

  const adapter = gateway.adapters.get('whatsapp')
  if (adapter) {
    adapter.sendMessage(FRANK_CHAT_ID, lines.join('\n'))
      .then(() => console.log(`[LienTracker] Sent daily alert (${critical.length} critical)`))
      .catch(err => console.error('[LienTracker] Send failed:', err.message))
  }
}

// ── Plugin Registration ─────────────────────────────────────────────

export function register(gateway) {
  // Intercept /lien and /liens commands
  const originalExecute = gateway.commandHandler.execute.bind(gateway.commandHandler)

  gateway.commandHandler.execute = async function (text, sessionKey, adapter, chatId) {
    const lower = text.trim().toLowerCase()

    if (lower.startsWith('/lien')) {
      const result = routeLienCommand(text)
      if (result) return result
    }

    return originalExecute(text, sessionKey, adapter, chatId)
  }

  // Extend /help
  const originalHelp = gateway.commandHandler.handleHelp.bind(gateway.commandHandler)
  gateway.commandHandler.handleHelp = function () {
    const result = originalHelp()
    const lienLines = [
      '',
      '--- Lien Tracker ---',
      '/liens — approaching lien deadlines',
      '/liens critical — within 14 days',
      '/lien <id> filed — mark lien filed',
      '/lien <id> demand — draft demand letter'
    ]
    result.response += '\n' + lienLines.join('\n')
    return result
  }

  // Daily cron: 10:35 AM, Mon-Sat
  let lastCronDate = null

  const timer = setInterval(() => {
    const now = new Date()
    const todayStr = now.toISOString().split('T')[0]
    const hour = now.getHours()
    const minute = now.getMinutes()
    const day = now.getDay()

    // Skip Sunday
    if (day === 0) return

    // No alerts before 10am or after 5am (Frank's schedule)
    if (hour < 10 || hour >= 5 && hour < 10) return

    // 10:35 AM daily check
    if (hour === 10 && minute === 35 && lastCronDate !== todayStr) {
      lastCronDate = todayStr
      runDailyLienCheck(gateway)
    }
  }, 60000) // check every minute

  gateway._lienTrackerTimer = timer

  console.log('[LienTracker] Loaded — /lien, /liens commands + daily 10:35 AM check')
}
