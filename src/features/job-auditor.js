import fs from 'fs'

/**
 * Job Auditor Feature
 * Audits all jobs for data completeness, reports quality scores, helps fix gaps.
 *
 * Commands:
 *   /audit                  - Full audit report of all jobs
 *   /audit FD-002           - Detailed audit of one job
 *   /audit fix FD-002       - Search sources for missing data
 *   /audit score            - Overall data quality score
 *   /audit missing <field>  - List all jobs missing a specific field
 *
 * Reads from: workspace/jobs.json
 */

import config from '../config.js'

const WORKSPACE = config.paths.workspace
const JOBS_FILE = config.paths.jobsFile
const MONDAY_CONFIG = `${config.paths.workspace}/monday-config.json`
const INBOX_STATE = `${config.paths.workspace}/inbox-mining-state.json`
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
      if (s === 'lien-filed') return '\u2696\uFE0F'
      return '\u26AA'
    },
    formatMoney(cents) {
      return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    },
    formatMoneyDollars(dollars) {
      if (dollars == null || isNaN(dollars)) return '$0.00'
      return '$' + Number(dollars).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    }
  }
}

// ── Audit field definitions ────────────────────────────────────────

const AUDIT_FIELDS = [
  { key: 'address',       weight: 15, label: 'Address',        check: v => typeof v === 'string' && v.trim().length > 0 },
  { key: 'city',          weight: 10, label: 'City',           check: v => typeof v === 'string' && v.trim().length > 0 },
  { key: 'adjuster',      weight: 10, label: 'Adjuster',       check: v => v != null && String(v).trim().length > 0 },
  { key: 'adjusterEmail', weight: 5,  label: 'Adjuster Email', check: v => v != null && String(v).trim().length > 0 },
  { key: 'invoiceAmount', weight: 10, label: 'Invoice Amount', check: v => v != null && Number(v) > 0 },
  { key: 'invoiceDate',   weight: 5,  label: 'Invoice Date',   check: v => v != null },
  { key: 'dateCompleted', weight: 5,  label: 'Date Completed', check: v => v != null },
  { key: 'driveFolderId', weight: 10, label: 'Drive Folder',   check: v => typeof v === 'string' && v.trim().length > 0 },
  { key: 'status',        weight: 5,  label: 'Status',         check: (v, job) => {
    // For old jobs (completed > 7 days ago), "needs-invoice" is a problem
    if ((v || '').toLowerCase() === 'needs-invoice' && job.dateCompleted) {
      const days = Math.floor((Date.now() - new Date(job.dateCompleted).getTime()) / MS_PER_DAY)
      if (days > 7) return false
    }
    return true
  }}
]

const TOTAL_WEIGHT = AUDIT_FIELDS.reduce((sum, f) => sum + f.weight, 0)

// ── Scoring ────────────────────────────────────────────────────────

function auditJob(job) {
  let score = 0
  const missing = []
  const present = []

  for (const field of AUDIT_FIELDS) {
    const value = job[field.key]
    if (field.check(value, job)) {
      score += field.weight
      present.push(field)
    } else {
      missing.push(field)
    }
  }

  const pct = Math.round((score / TOTAL_WEIGHT) * 100)
  return { score, pct, missing, present }
}

// ── /audit — Full audit report ─────────────────────────────────────

function handleFullAudit() {
  const jobs = jobData.loadJobs()
  if (jobs.length === 0) {
    return { handled: true, response: 'No jobs found in workspace/jobs.json.' }
  }

  // Calculate per-field missing counts
  const fieldMissing = {}
  for (const f of AUDIT_FIELDS) {
    fieldMissing[f.key] = { label: f.label, count: 0 }
  }

  let totalScore = 0
  const audited = []

  // Count by status
  const statusCounts = {}

  for (const job of jobs) {
    const audit = auditJob(job)
    totalScore += audit.pct
    audited.push({ job, audit })

    for (const m of audit.missing) {
      fieldMissing[m.key].count++
    }

    const status = (job.status || 'unknown').toLowerCase()
    statusCounts[status] = (statusCounts[status] || 0) + 1
  }

  const overallPct = Math.round(totalScore / jobs.length)

  // Sort by worst score first
  audited.sort((a, b) => a.audit.pct - b.audit.pct)

  const lines = [
    '\u{1F4CA} *Job Data Audit*',
    '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501',
    '',
    `Overall: ${overallPct}% complete (${jobs.length} jobs)`,
    '',
    '*Missing fields:*'
  ]

  // Sort fields by most missing
  const sortedFields = Object.values(fieldMissing).sort((a, b) => b.count - a.count)
  for (const f of sortedFields) {
    if (f.count === 0) continue
    const pct = Math.round((f.count / jobs.length) * 100)
    lines.push(`\u2022 ${f.label}: ${f.count} jobs (${pct}%)`)
  }

  // Status breakdown
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

  lines.push('')
  lines.push('*By status:*')
  for (const [status, count] of Object.entries(statusCounts)) {
    const label = statusMap[status] || `\u26AA ${status}`
    lines.push(`\u2022 ${label}: ${count} jobs`)
  }

  // Top priority (worst data)
  lines.push('')
  lines.push('*Top priority (most missing data):*')
  const worst = audited.slice(0, 5)
  for (let i = 0; i < worst.length; i++) {
    const { job, audit } = worst[i]
    const client = job.client || 'Unknown'
    const missingLabels = audit.missing.slice(0, 4).map(f => f.label.toLowerCase()).join(', ')
    const extra = audit.missing.length > 4 ? ` +${audit.missing.length - 4} more` : ''
    lines.push(`${i + 1}. ${job.id} - ${client} (${audit.pct}% complete) \u2014 missing: ${missingLabels}${extra}`)
  }

  return { handled: true, response: lines.join('\n') }
}

// ── /audit FD-002 — Single job audit ───────────────────────────────

function handleJobAudit(idStr) {
  const job = jobData.findJob(idStr)
  if (!job) {
    return { handled: true, response: `Job not found: ${idStr}` }
  }

  const audit = auditJob(job)
  const client = job.client || 'Unknown'

  const lines = [
    `\u{1F50D} *Audit: ${job.id} - ${client}*`,
    '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501',
    '',
    `Score: ${audit.pct}% complete`,
    ''
  ]

  // Show all fields
  for (const field of AUDIT_FIELDS) {
    const value = job[field.key]
    const passed = field.check(value, job)

    if (passed) {
      let display = value
      if (field.key === 'invoiceAmount') display = jobData.formatMoneyDollars(value)
      else if (field.key === 'driveFolderId') display = 'linked'
      else if (field.key === 'status') display = value
      else if (field.key === 'invoiceDate' || field.key === 'dateCompleted') display = jobData.formatDate(value)
      lines.push(`\u2705 ${field.label}: ${display}`)
    } else {
      if (field.key === 'status') {
        lines.push(`\u26A0\uFE0F ${field.label}: ${value || 'unknown'} (stale for old job)`)
      } else if (field.key === 'invoiceAmount') {
        lines.push(`\u274C ${field.label}: not set`)
      } else {
        lines.push(`\u274C ${field.label}: missing`)
      }
    }
  }

  // Lien deadline info
  if (job.lienDeadline) {
    const days = jobData.daysUntil(job.lienDeadline)
    const urgency = days <= 14 ? '\u{1F6A8}' : days <= 30 ? '\u26A0\uFE0F' : '\u{1F4C5}'
    lines.push('')
    lines.push(`${urgency} Lien deadline: ${jobData.formatDate(job.lienDeadline)} (${days} days)`)
  }

  // Drive link
  if (job.driveUrl) {
    lines.push('')
    lines.push(`\u{1F4C1} Drive: ${job.driveUrl}`)
  }

  lines.push('')
  lines.push(`\u{1F4A1} Run \`/audit fix ${job.id}\` to search Monday/email for missing data`)

  return { handled: true, response: lines.join('\n') }
}

// ── /audit fix FD-002 — Search sources ─────────────────────────────

function handleAuditFix(idStr) {
  const job = jobData.findJob(idStr)
  if (!job) {
    return { handled: true, response: `Job not found: ${idStr}` }
  }

  const audit = auditJob(job)
  const client = job.client || 'Unknown'

  if (audit.missing.length === 0) {
    return { handled: true, response: `\u2705 ${job.id} - ${client} is 100% complete! No missing data.` }
  }

  const lines = [
    `\u{1F50E} *Data Fix: ${job.id} - ${client}*`,
    '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501',
    '',
    `Missing ${audit.missing.length} field${audit.missing.length > 1 ? 's' : ''}: ${audit.missing.map(f => f.label).join(', ')}`,
    '',
    '*Searching data sources...*',
    ''
  ]

  // Check Monday config
  let mondayData = null
  try {
    if (fs.existsSync(MONDAY_CONFIG)) {
      mondayData = JSON.parse(fs.readFileSync(MONDAY_CONFIG, 'utf-8'))
    }
  } catch { /* ignore */ }

  if (mondayData && mondayData.boardId) {
    lines.push('\u{1F4CB} *Monday.com:*')
    if (mondayData.lastSync) {
      lines.push(`  Last synced: ${jobData.formatDate(mondayData.lastSync)}`)
      lines.push(`  Board configured with ${mondayData.importedCount || 0} imports`)
      lines.push('  \u2192 Try `/monday sync` to pull latest data')
    } else {
      lines.push('  Board configured but never synced')
      lines.push('  \u2192 Run `/monday sync` to import data')
    }
  } else {
    lines.push('\u{1F4CB} *Monday.com:* Not configured')
    lines.push('  \u2192 Set up with `/monday setup <board-url>` to import job data')
  }
  lines.push('')

  // Check inbox mining state
  let inboxData = null
  try {
    if (fs.existsSync(INBOX_STATE)) {
      inboxData = JSON.parse(fs.readFileSync(INBOX_STATE, 'utf-8'))
    }
  } catch { /* ignore */ }

  if (inboxData) {
    lines.push('\u{1F4E7} *Email Mining:*')
    const clientEmails = inboxData.clients?.[client] || inboxData.clients?.[job.id]
    if (clientEmails) {
      lines.push(`  Found data for ${client}:`)
      if (clientEmails.address) lines.push(`  \u2022 Address: ${clientEmails.address}`)
      if (clientEmails.adjuster) lines.push(`  \u2022 Adjuster: ${clientEmails.adjuster}`)
      if (clientEmails.adjusterEmail) lines.push(`  \u2022 Adjuster Email: ${clientEmails.adjusterEmail}`)
      lines.push('  \u2192 Reply "apply" to update this job')
    } else {
      lines.push('  No extracted data for this client')
      lines.push('  \u2192 Run `/inbox mine` to scan emails for job data')
    }
  } else {
    lines.push('\u{1F4E7} *Email Mining:* Not configured')
    lines.push('  \u2192 Set up with `/inbox setup` to scan emails for adjuster/address data')
  }
  lines.push('')

  // Drive folder check
  if (job.driveFolderId) {
    lines.push('\u{1F4C1} *Google Drive:*')
    lines.push(`  Folder linked: ${job.driveUrl || job.driveFolderId}`)
    lines.push('  \u2192 Check scope sheets/estimates in Drive for address and amount data')
  }
  lines.push('')

  // Manual fix suggestions
  lines.push('*Manual fix:*')
  for (const m of audit.missing) {
    if (m.key === 'address') lines.push('  \u2022 `/job update ' + job.id + ' address <value>`')
    else if (m.key === 'city') lines.push('  \u2022 `/job update ' + job.id + ' city <value>`')
    else if (m.key === 'adjuster') lines.push('  \u2022 `/job update ' + job.id + ' adjuster <name>`')
    else if (m.key === 'adjusterEmail') lines.push('  \u2022 `/job update ' + job.id + ' adjusterEmail <email>`')
    else if (m.key === 'invoiceAmount') lines.push('  \u2022 `/job update ' + job.id + ' invoiceAmount <dollars>`')
    else if (m.key === 'invoiceDate') lines.push('  \u2022 `/job update ' + job.id + ' invoiceDate <YYYY-MM-DD>`')
  }

  return { handled: true, response: lines.join('\n') }
}

// ── /audit score — Overall quality score ───────────────────────────

function handleAuditScore() {
  const jobs = jobData.loadJobs()
  if (jobs.length === 0) {
    return { handled: true, response: 'No jobs found.' }
  }

  let totalScore = 0
  let perfect = 0
  let good = 0    // 70+
  let fair = 0    // 40-69
  let poor = 0    // < 40

  for (const job of jobs) {
    const audit = auditJob(job)
    totalScore += audit.pct
    if (audit.pct === 100) perfect++
    else if (audit.pct >= 70) good++
    else if (audit.pct >= 40) fair++
    else poor++
  }

  const overallPct = Math.round(totalScore / jobs.length)

  // Visual bar
  const filled = Math.round(overallPct / 5)
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(20 - filled)

  const lines = [
    '\u{1F4CA} *Data Quality Score*',
    '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501',
    '',
    `[${bar}] ${overallPct}%`,
    '',
    `\u{1F7E2} Perfect (100%): ${perfect} jobs`,
    `\u{1F535} Good (70-99%): ${good} jobs`,
    `\u{1F7E1} Fair (40-69%): ${fair} jobs`,
    `\u{1F534} Poor (<40%): ${poor} jobs`,
    '',
    `Total: ${jobs.length} jobs tracked`,
    '',
  ]

  if (overallPct < 50) {
    lines.push('\u26A0\uFE0F Data quality is low. Run `/audit` to see what\'s missing.')
    lines.push('Priority: fill in addresses and adjuster info first.')
  } else if (overallPct < 80) {
    lines.push('\u{1F4AA} Getting there! Focus on the poor-scoring jobs.')
    lines.push('Run `/audit` to see the worst offenders.')
  } else {
    lines.push('\u2705 Great data quality! Keep it up.')
  }

  return { handled: true, response: lines.join('\n') }
}

// ── /audit missing <field> — Jobs missing a specific field ─────────

function handleAuditMissing(fieldName) {
  const normalizedField = fieldName.toLowerCase().replace(/[_\s-]/g, '')

  // Map common names to field keys
  const fieldMap = {
    address: 'address',
    addr: 'address',
    city: 'city',
    adjuster: 'adjuster',
    adj: 'adjuster',
    adjusteremail: 'adjusterEmail',
    email: 'adjusterEmail',
    invoiceamount: 'invoiceAmount',
    amount: 'invoiceAmount',
    invoice: 'invoiceAmount',
    invoicedate: 'invoiceDate',
    datecompleted: 'dateCompleted',
    completed: 'dateCompleted',
    drivefolderid: 'driveFolderId',
    drive: 'driveFolderId',
    folder: 'driveFolderId',
    status: 'status'
  }

  const fieldKey = fieldMap[normalizedField]
  if (!fieldKey) {
    const validFields = [...new Set(Object.values(fieldMap))].join(', ')
    return { handled: true, response: `Unknown field: "${fieldName}"\n\nValid fields: ${validFields}` }
  }

  const fieldDef = AUDIT_FIELDS.find(f => f.key === fieldKey)
  if (!fieldDef) {
    return { handled: true, response: `Field "${fieldName}" not tracked in audit.` }
  }

  const jobs = jobData.loadJobs()
  const missing = jobs.filter(j => !fieldDef.check(j[fieldKey], j))

  if (missing.length === 0) {
    return { handled: true, response: `\u2705 All ${jobs.length} jobs have ${fieldDef.label} filled in!` }
  }

  const pct = Math.round((missing.length / jobs.length) * 100)
  const lines = [
    `\u{1F50D} *Jobs Missing: ${fieldDef.label}*`,
    `${missing.length} of ${jobs.length} jobs (${pct}%)`,
    '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501',
    ''
  ]

  for (const job of missing.slice(0, 20)) {
    const client = job.client || 'Unknown'
    const status = job.status || 'unknown'
    lines.push(`\u2022 ${job.id} - ${client} (${status})`)
  }

  if (missing.length > 20) {
    lines.push(`\n... +${missing.length - 20} more`)
  }

  return { handled: true, response: lines.join('\n') }
}

// ── Passive reminder helper ────────────────────────────────────────

function getAuditReminder(jobId) {
  const job = jobData.findJob(jobId)
  if (!job) return null

  const audit = auditJob(job)
  if (audit.missing.length === 0) return null

  const missingLabels = audit.missing.slice(0, 3).map(f => f.label.toLowerCase()).join(', ')
  const extra = audit.missing.length > 3 ? ` +${audit.missing.length - 3} more` : ''
  return `\u26A0\uFE0F ${job.id} missing: ${missingLabels}${extra}`
}

// ── Command Router ─────────────────────────────────────────────────

async function handleAudit(text) {
  const rest = text.slice(6).trim() // strip "/audit"

  // /audit (no args)
  if (!rest) return handleFullAudit()

  // /audit score
  if (rest.toLowerCase() === 'score') return handleAuditScore()

  // /audit missing <field>
  if (rest.toLowerCase().startsWith('missing')) {
    const field = rest.slice(7).trim()
    if (!field) {
      return { handled: true, response: 'Usage: `/audit missing <field>`\nExample: `/audit missing address`' }
    }
    return handleAuditMissing(field)
  }

  // /audit fix FD-002
  if (rest.toLowerCase().startsWith('fix')) {
    const id = rest.slice(3).trim()
    if (!id) {
      return { handled: true, response: 'Usage: `/audit fix <job-id>`\nExample: `/audit fix FD-002`' }
    }
    return handleAuditFix(id)
  }

  // /audit FD-002 (single job)
  return handleJobAudit(rest)
}

// ── Plugin Registration ────────────────────────────────────────────

export function register(gateway) {
  const originalExecute = gateway.commandHandler.execute.bind(gateway.commandHandler)

  gateway.commandHandler.execute = async function (text, sessionKey, adapter, chatId) {
    const trimmed = text.trim()
    const lower = trimmed.toLowerCase()

    if (lower.startsWith('/audit')) {
      try {
        const result = await handleAudit(trimmed)
        return result
      } catch (err) {
        return { handled: true, response: `Audit error: ${err.message}` }
      }
    }

    return originalExecute(text, sessionKey, adapter, chatId)
  }

  // Expose passive reminder helper for other features
  gateway._jobAuditReminder = getAuditReminder

  // Extend /help
  if (gateway.commandHandler.handleHelp) {
    const originalHelp = gateway.commandHandler.handleHelp.bind(gateway.commandHandler)
    gateway.commandHandler.handleHelp = function () {
      const result = originalHelp()
      const auditLines = [
        '',
        '--- Job Auditor ---',
        '/audit \u2014 full data quality audit',
        '/audit <id> \u2014 audit single job',
        '/audit fix <id> \u2014 search sources for missing data',
        '/audit score \u2014 overall quality score',
        '/audit missing <field> \u2014 jobs missing a field'
      ]
      result.response += '\n' + auditLines.join('\n')
      return result
    }
  }

  console.log('[JobAuditor] Feature loaded \u2014 /audit commands enabled')
}
