import fs from 'fs'
import path from 'path'

/**
 * Job Tracker Feature
 * Tracks restoration jobs for invoicing — prevents revenue loss from forgotten jobs
 *
 * Commands:
 *   /job new <client> - <address>, <city>
 *   /job list
 *   /job list unpaid
 *   /job <id> status <new-status>
 *   /job <id> invoice <amount>
 *   /job <id> paid
 *   /job <id> adjuster <name> <email>
 *   /job <id> note <text>
 *   /jobs              — alias for /job list
 *   /jobs urgent       — needs-invoice + payment-pending + approaching lien deadline
 *
 * Storage: workspace/jobs.json
 */

import config from '../config.js'
import { loadJobs, saveJobs, makeJobId, addDays, formatDate, formatMoneyDollars, daysUntil, findJobInData } from '../utils/job-data.js'

const VALID_STATUSES = [
  'active',
  'completed',
  'needs-invoice',
  'invoiced',
  'payment-pending',
  'paid',
  'disputed',
  'lien-filed',
  'closed'
]

// Days from creation to lien deadline
const LIEN_DEADLINE_DAYS = 90

// ── Command Handlers ────────────────────────────────────────────────

function handleJobNew(argsStr) {
  // Expected: <client> - <address>, <city>
  const dashIdx = argsStr.indexOf(' - ')
  if (dashIdx === -1) {
    return {
      handled: true,
      response: 'Usage: /job new <client> - <address>, <city>\nExample: /job new Smith - 123 Oak St, Vienna'
    }
  }

  const client = argsStr.slice(0, dashIdx).trim()
  const rest = argsStr.slice(dashIdx + 3).trim()

  // Split address and city on last comma
  const lastComma = rest.lastIndexOf(',')
  let address, city
  if (lastComma !== -1) {
    address = rest.slice(0, lastComma).trim()
    city = rest.slice(lastComma + 1).trim()
  } else {
    address = rest
    city = ''
  }

  if (!client || !address) {
    return {
      handled: true,
      response: 'Usage: /job new <client> - <address>, <city>\nExample: /job new Smith - 123 Oak St, Vienna'
    }
  }

  const data = loadJobs()
  const now = new Date().toISOString()
  const job = {
    id: makeJobId(data.nextId),
    client,
    address,
    city,
    status: 'active',
    dateCreated: now,
    dateCompleted: null,
    invoiceAmount: null,
    invoiceDate: null,
    paymentDate: null,
    adjuster: null,
    adjusterEmail: null,
    notes: [],
    lienDeadline: addDays(now, LIEN_DEADLINE_DAYS)
  }

  data.jobs.push(job)
  data.nextId++
  saveJobs(data)

  const lienDate = formatDate(job.lienDeadline)
  return {
    handled: true,
    response: [
      `Job created: *${job.id}*`,
      `Client: ${client}`,
      `Address: ${address}${city ? ', ' + city : ''}`,
      `Status: active`,
      `Lien deadline: ${lienDate}`,
      '',
      `Use /job ${job.id} status completed when work is done`
    ].join('\n')
  }
}

function handleJobList(filter) {
  const data = loadJobs()

  if (data.jobs.length === 0) {
    return { handled: true, response: 'No jobs tracked yet. Use /job new to add one.' }
  }

  let jobs = data.jobs

  if (filter === 'unpaid') {
    jobs = jobs.filter(j =>
      ['needs-invoice', 'invoiced', 'payment-pending', 'disputed'].includes(j.status)
    )
    if (jobs.length === 0) {
      return { handled: true, response: 'No unpaid jobs. Nice!' }
    }
  }

  // Group by status, show needs-invoice first
  const statusOrder = [
    'needs-invoice',
    'payment-pending',
    'disputed',
    'invoiced',
    'active',
    'completed',
    'lien-filed',
    'paid',
    'closed'
  ]

  const grouped = {}
  for (const j of jobs) {
    if (!grouped[j.status]) grouped[j.status] = []
    grouped[j.status].push(j)
  }

  const lines = [`*Jobs* (${jobs.length} total)`, '']

  for (const status of statusOrder) {
    const group = grouped[status]
    if (!group || group.length === 0) continue

    const label = status.toUpperCase().replace('-', ' ')
    lines.push(`--- ${label} (${group.length}) ---`)
    for (const j of group) {
      let line = `${j.id} | ${j.client} | ${j.address}`
      if (j.city) line += `, ${j.city}`
      if (j.invoiceAmount != null) line += ` | ${formatMoneyDollars(j.invoiceAmount)}`
      const lienDays = daysUntil(j.lienDeadline)
      if (lienDays <= 14 && !['paid', 'closed', 'lien-filed'].includes(j.status)) {
        line += ` | LIEN IN ${lienDays}d`
      }
      lines.push(line)
    }
    lines.push('')
  }

  return { handled: true, response: lines.join('\n').trim() }
}

function handleJobsUrgent() {
  const data = loadJobs()
  const now = new Date()

  const urgent = data.jobs.filter(j => {
    if (['paid', 'closed'].includes(j.status)) return false
    if (j.status === 'needs-invoice') return true
    if (j.status === 'payment-pending') return true
    if (j.lienDeadline && daysUntil(j.lienDeadline) <= 21) return true
    return false
  })

  if (urgent.length === 0) {
    return { handled: true, response: 'No urgent jobs right now.' }
  }

  // Sort by lien deadline (soonest first)
  urgent.sort((a, b) => {
    const da = a.lienDeadline ? new Date(a.lienDeadline) : new Date('2099-01-01')
    const db = b.lienDeadline ? new Date(b.lienDeadline) : new Date('2099-01-01')
    return da - db
  })

  const lines = [`*URGENT JOBS* (${urgent.length})`, '']

  for (const j of urgent) {
    const lienDays = daysUntil(j.lienDeadline)
    let flag = ''
    if (lienDays <= 7) flag = ' *** LIEN IMMINENT ***'
    else if (lienDays <= 14) flag = ' ** lien soon **'
    else if (lienDays <= 21) flag = ' * lien approaching *'

    let line = `${j.id} | ${j.client} | ${j.status.toUpperCase()}`
    if (j.invoiceAmount != null) line += ` | ${formatMoneyDollars(j.invoiceAmount)}`
    line += ` | Lien: ${formatDate(j.lienDeadline)} (${lienDays}d)${flag}`
    lines.push(line)
  }

  // Summary
  const needsInvoice = urgent.filter(j => j.status === 'needs-invoice')
  const pendingPayment = urgent.filter(j => j.status === 'payment-pending')
  const lienSoon = urgent.filter(j => daysUntil(j.lienDeadline) <= 14)

  lines.push('')
  if (needsInvoice.length) lines.push(`Needs invoice: ${needsInvoice.length}`)
  if (pendingPayment.length) lines.push(`Awaiting payment: ${pendingPayment.length}`)
  if (lienSoon.length) lines.push(`Lien deadline <14d: ${lienSoon.length}`)

  return { handled: true, response: lines.join('\n') }
}

function handleJobStatus(job, newStatus, data) {
  if (!VALID_STATUSES.includes(newStatus)) {
    return {
      handled: true,
      response: `Invalid status. Valid statuses:\n${VALID_STATUSES.join(', ')}`
    }
  }

  const oldStatus = job.status
  job.status = newStatus

  // Auto-set dateCompleted when moving to completed or needs-invoice
  if (['completed', 'needs-invoice'].includes(newStatus) && !job.dateCompleted) {
    job.dateCompleted = new Date().toISOString()
  }

  saveJobs(data)

  const lines = [`*${job.id}* status: ${oldStatus} -> *${newStatus}*`]
  if (newStatus === 'completed') {
    lines.push('Tip: Use /job ' + job.id + ' status needs-invoice when ready to bill')
  }
  if (newStatus === 'needs-invoice') {
    lines.push('Use /job ' + job.id + ' invoice <amount> to record the invoice')
  }

  return { handled: true, response: lines.join('\n') }
}

function handleJobInvoice(job, amountStr, data) {
  const amount = parseFloat(amountStr.replace(/[$,]/g, ''))
  if (isNaN(amount) || amount <= 0) {
    return { handled: true, response: 'Usage: /job <id> invoice <amount>\nExample: /job FD-001 invoice 4500' }
  }

  job.invoiceAmount = amount
  job.invoiceDate = new Date().toISOString()
  job.status = 'invoiced'
  saveJobs(data)

  return {
    handled: true,
    response: [
      `*${job.id}* invoiced: ${formatMoneyDollars(amount)}`,
      `Client: ${job.client}`,
      `Invoice date: ${formatDate(job.invoiceDate)}`,
      `Lien deadline: ${formatDate(job.lienDeadline)}`,
      '',
      `Use /job ${job.id} status payment-pending after sending`
    ].join('\n')
  }
}

function handleJobPaid(job, data) {
  job.status = 'paid'
  job.paymentDate = new Date().toISOString()
  saveJobs(data)

  return {
    handled: true,
    response: [
      `*${job.id}* marked PAID`,
      `Client: ${job.client}`,
      `Amount: ${formatMoneyDollars(job.invoiceAmount)}`,
      `Payment date: ${formatDate(job.paymentDate)}`
    ].join('\n')
  }
}

function handleJobAdjuster(job, argsStr, data) {
  // Parse: <name> <email>
  const parts = argsStr.trim().split(/\s+/)
  if (parts.length < 2) {
    return {
      handled: true,
      response: 'Usage: /job <id> adjuster <name> <email>\nExample: /job FD-001 adjuster "John Smith" john@statefarm.com'
    }
  }

  // Last part is email if it contains @, rest is name
  let email = null
  let nameParts = [...parts]

  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].includes('@')) {
      email = parts[i]
      nameParts = parts.slice(0, i)
      break
    }
  }

  const name = nameParts.join(' ').replace(/"/g, '')

  if (!name) {
    return {
      handled: true,
      response: 'Usage: /job <id> adjuster <name> <email>'
    }
  }

  job.adjuster = name
  if (email) job.adjusterEmail = email
  saveJobs(data)

  return {
    handled: true,
    response: `*${job.id}* adjuster set: ${name}${email ? ' (' + email + ')' : ''}`
  }
}

function handleJobNote(job, noteText, data) {
  if (!noteText) {
    return { handled: true, response: 'Usage: /job <id> note <text>' }
  }

  if (!Array.isArray(job.notes)) job.notes = []
  job.notes.push({
    text: noteText,
    date: new Date().toISOString()
  })
  saveJobs(data)

  return {
    handled: true,
    response: `*${job.id}* note added (${job.notes.length} total)`
  }
}

function handleJobDetail(job) {
  const lienDays = daysUntil(job.lienDeadline)
  const lienWarning = lienDays <= 14 && !['paid', 'closed', 'lien-filed'].includes(job.status)
    ? ` *** ${lienDays} DAYS LEFT ***`
    : ''

  const lines = [
    `*${job.id}* — ${job.client}`,
    '',
    `Address: ${job.address}${job.city ? ', ' + job.city : ''}`,
    `Status: *${job.status}*`,
    `Created: ${formatDate(job.dateCreated)}`,
  ]

  if (job.dateCompleted) lines.push(`Completed: ${formatDate(job.dateCompleted)}`)
  if (job.invoiceAmount != null) lines.push(`Invoice: ${formatMoneyDollars(job.invoiceAmount)}`)
  if (job.invoiceDate) lines.push(`Invoiced: ${formatDate(job.invoiceDate)}`)
  if (job.paymentDate) lines.push(`Paid: ${formatDate(job.paymentDate)}`)
  if (job.adjuster) lines.push(`Adjuster: ${job.adjuster}${job.adjusterEmail ? ' (' + job.adjusterEmail + ')' : ''}`)
  lines.push(`Lien deadline: ${formatDate(job.lienDeadline)}${lienWarning}`)

  if (job.notes && job.notes.length > 0) {
    lines.push('')
    lines.push(`Notes (${job.notes.length}):`)
    for (const n of job.notes.slice(-5)) {
      lines.push(`  ${formatDate(n.date)}: ${n.text}`)
    }
    if (job.notes.length > 5) {
      lines.push(`  ... +${job.notes.length - 5} older`)
    }
  }

  return { handled: true, response: lines.join('\n') }
}

// ── Main Router ─────────────────────────────────────────────────────

function routeJobCommand(text) {
  const trimmed = text.trim()
  const lower = trimmed.toLowerCase()

  // /jobs aliases
  if (lower === '/jobs') return handleJobList()
  if (lower === '/jobs urgent') return handleJobsUrgent()

  // Must start with /job
  if (!lower.startsWith('/job')) return null

  // Strip "/job " prefix
  const rest = trimmed.slice(4).trim()
  const restLower = rest.toLowerCase()

  // /job (no args) — show help
  if (!rest) return jobHelp()

  // /job new ...
  if (restLower.startsWith('new ')) {
    return handleJobNew(rest.slice(4).trim())
  }

  // /job list [filter]
  if (restLower === 'list') return handleJobList()
  if (restLower === 'list unpaid') return handleJobList('unpaid')

  // /job <id> [subcommand] ...
  // First token is the ID
  const spaceIdx = rest.indexOf(' ')
  if (spaceIdx === -1) {
    // Just an ID — show detail
    const data = loadJobs()
    const job = findJobInData(data, rest)
    if (!job) return { handled: true, response: `Job not found: ${rest}` }
    return handleJobDetail(job)
  }

  const idStr = rest.slice(0, spaceIdx)
  const subRest = rest.slice(spaceIdx + 1).trim()
  const subLower = subRest.toLowerCase()

  const data = loadJobs()
  const job = findJobInData(data, idStr)
  if (!job) return { handled: true, response: `Job not found: ${idStr}` }

  // /job <id> status <new-status>
  if (subLower.startsWith('status ')) {
    const newStatus = subLower.slice(7).trim()
    return handleJobStatus(job, newStatus, data)
  }

  // /job <id> invoice <amount>
  if (subLower.startsWith('invoice ')) {
    return handleJobInvoice(job, subRest.slice(8).trim(), data)
  }

  // /job <id> paid
  if (subLower === 'paid') {
    return handleJobPaid(job, data)
  }

  // /job <id> adjuster <name> <email>
  if (subLower.startsWith('adjuster ')) {
    return handleJobAdjuster(job, subRest.slice(9).trim(), data)
  }

  // /job <id> note <text>
  if (subLower.startsWith('note ')) {
    return handleJobNote(job, subRest.slice(5).trim(), data)
  }

  // Unknown subcommand — show detail
  return handleJobDetail(job)
}

function jobHelp() {
  return {
    handled: true,
    response: [
      '*Job Tracker Commands*',
      '',
      '/job new <client> - <address>, <city>',
      '/job list — all jobs by status',
      '/job list unpaid — unpaid/overdue only',
      '/job <id> — job detail',
      '/job <id> status <status> — update status',
      '/job <id> invoice <amount> — record invoice',
      '/job <id> paid — mark as paid',
      '/job <id> adjuster <name> <email>',
      '/job <id> note <text> — add a note',
      '/jobs — alias for /job list',
      '/jobs urgent — needs-invoice + approaching deadlines',
      '',
      'Statuses: ' + VALID_STATUSES.join(', ')
    ].join('\n')
  }
}

// ── Plugin Registration ─────────────────────────────────────────────

export function register(gateway) {
  // Ensure workspace directory exists
  const dir = path.dirname(config.paths.jobsFile)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  // Wrap the command handler to intercept /job and /jobs before default routing
  const originalExecute = gateway.commandHandler.execute.bind(gateway.commandHandler)

  gateway.commandHandler.execute = async function (text, sessionKey, adapter, chatId) {
    const lower = text.trim().toLowerCase()

    if (lower.startsWith('/job') || lower.startsWith('/jobs')) {
      const result = routeJobCommand(text)
      if (result) return result
    }

    return originalExecute(text, sessionKey, adapter, chatId)
  }

  // Extend /help output by wrapping handleHelp
  const originalHelp = gateway.commandHandler.handleHelp.bind(gateway.commandHandler)

  gateway.commandHandler.handleHelp = function () {
    const result = originalHelp()
    const jobLines = [
      '',
      '--- Job Tracker ---',
      '/job new <client> - <address>, <city>',
      '/job list — all jobs by status',
      '/job list unpaid — unpaid/overdue only',
      '/job <id> — job detail',
      '/job <id> status/invoice/paid/adjuster/note',
      '/jobs — alias for /job list',
      '/jobs urgent — needs-invoice + deadlines'
    ]
    result.response += '\n' + jobLines.join('\n')
    return result
  }

  console.log('[JobTracker] Loaded — /job, /jobs commands enabled')
}
