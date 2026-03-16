import fs from 'fs'
import path from 'path'

/**
 * Adjuster Dispute Tracker Feature
 * Tracks insurance adjuster disputes per job — prevents revenue loss from underpayment
 *
 * Commands:
 *   /dispute <job-id> "<reason>"                      — create dispute
 *   /dispute <job-id> doc-requested "<description>"   — record doc request from adjuster
 *   /dispute <job-id> doc-sent "<description>"        — record doc sent to adjuster
 *   /dispute <job-id> resolved <amount>               — mark resolved with settlement amount
 *   /disputes                                         — list all open disputes
 *   /disputes overdue                                 — where adjuster silent 7+ days
 *
 * Storage: workspace/disputes.json
 */

import config from '../config.js'

const DISPUTES_FILE = config.paths.disputesFile
const JOBS_FILE = config.paths.jobsFile

const OVERDUE_DAYS = 7
const MS_PER_DAY = 86400000

// ── Storage ─────────────────────────────────────────────────────────

function loadDisputes() {
  try {
    if (fs.existsSync(DISPUTES_FILE)) {
      return JSON.parse(fs.readFileSync(DISPUTES_FILE, 'utf-8'))
    }
  } catch (err) {
    console.error('[AdjusterTracker] Failed to load disputes:', err.message)
  }
  return { disputes: [] }
}

function saveDisputes(data) {
  const dir = path.dirname(DISPUTES_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(DISPUTES_FILE, JSON.stringify(data, null, 2))
}

function loadJobs() {
  try {
    if (fs.existsSync(JOBS_FILE)) {
      return JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'))
    }
  } catch (err) {
    console.error('[AdjusterTracker] Failed to load jobs:', err.message)
  }
  return { nextId: 1, jobs: [] }
}

// ── Helpers ─────────────────────────────────────────────────────────

function findJob(jobId) {
  const data = loadJobs()
  const upper = jobId.toUpperCase()
  return data.jobs.find(j => {
    if (j.id === upper) return true
    const num = parseInt(jobId, 10)
    if (!isNaN(num) && j.id === `FD-${String(num).padStart(3, '0')}`) return true
    return false
  })
}

function normalizeJobId(jobId) {
  const upper = jobId.toUpperCase()
  if (upper.startsWith('FD-')) return upper
  const num = parseInt(jobId, 10)
  if (!isNaN(num)) return `FD-${String(num).padStart(3, '0')}`
  return upper
}

function findDispute(data, jobId) {
  const nid = normalizeJobId(jobId)
  return data.disputes.find(d => d.jobId === nid && d.status === 'open')
}

function formatDate(isoStr) {
  if (!isoStr) return '—'
  return new Date(isoStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
}

function formatMoney(amount) {
  if (amount == null) return '—'
  return '$' + Number(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

function daysSince(isoStr) {
  if (!isoStr) return Infinity
  return Math.floor((Date.now() - new Date(isoStr).getTime()) / MS_PER_DAY)
}

/**
 * Parse a quoted string from the beginning of a text.
 * Supports both "quoted" and unquoted-rest-of-line.
 */
function parseQuoted(text) {
  const trimmed = text.trim()
  if (trimmed.startsWith('"')) {
    const endQuote = trimmed.indexOf('"', 1)
    if (endQuote !== -1) {
      return trimmed.slice(1, endQuote)
    }
    // No closing quote — take everything after the opening quote
    return trimmed.slice(1)
  }
  // No quotes — take everything
  return trimmed
}

// ── Command Handlers ────────────────────────────────────────────────

function handleDisputeCreate(jobId, reasonText) {
  const reason = parseQuoted(reasonText)
  if (!reason) {
    return {
      handled: true,
      response: 'Usage: /dispute <job-id> "reason for dispute"\nExample: /dispute FD-002 "adjuster denied 3 dehu days"'
    }
  }

  const job = findJob(jobId)
  if (!job) {
    return { handled: true, response: `Job not found: ${jobId}` }
  }

  const data = loadDisputes()
  const existing = findDispute(data, jobId)
  if (existing) {
    return {
      handled: true,
      response: `${job.id} already has an open dispute (opened ${formatDate(existing.createdAt)}).\nUse /dispute ${job.id} doc-requested or doc-sent to update it.`
    }
  }

  const now = new Date().toISOString()
  const dispute = {
    jobId: job.id,
    client: job.client,
    adjuster: job.adjuster || null,
    adjusterEmail: job.adjusterEmail || null,
    invoiceAmount: job.invoiceAmount || null,
    invoiceDate: job.invoiceDate || null,
    reason,
    status: 'open',
    createdAt: now,
    lastActivityAt: now,
    resolvedAt: null,
    resolvedAmount: null,
    timeline: [
      { type: 'created', description: reason, date: now }
    ]
  }

  data.disputes.push(dispute)
  saveDisputes(data)

  return {
    handled: true,
    response: [
      `Dispute opened for *${job.id}* — ${job.client}`,
      `Reason: ${reason}`,
      job.adjuster ? `Adjuster: ${job.adjuster}${job.adjusterEmail ? ' (' + job.adjusterEmail + ')' : ''}` : 'No adjuster on file — use /job ' + job.id + ' adjuster <name> <email>',
      job.invoiceAmount != null ? `Invoice: ${formatMoney(job.invoiceAmount)}` : '',
      '',
      'Next: /dispute ' + job.id + ' doc-requested "what they asked for"'
    ].filter(Boolean).join('\n')
  }
}

function handleDocRequested(jobId, descText) {
  const description = parseQuoted(descText)
  if (!description) {
    return {
      handled: true,
      response: 'Usage: /dispute <job-id> doc-requested "description"\nExample: /dispute FD-002 doc-requested "need moisture logs"'
    }
  }

  const data = loadDisputes()
  const dispute = findDispute(data, jobId)
  if (!dispute) {
    return {
      handled: true,
      response: `No open dispute found for ${normalizeJobId(jobId)}.\nUse /dispute ${normalizeJobId(jobId)} "reason" to create one.`
    }
  }

  const now = new Date().toISOString()
  dispute.lastActivityAt = now
  dispute.timeline.push({
    type: 'doc-requested',
    description,
    date: now
  })

  saveDisputes(data)

  return {
    handled: true,
    response: [
      `*${dispute.jobId}* — Doc requested recorded`,
      `Request: ${description}`,
      `Timeline: ${dispute.timeline.length} events`,
      '',
      `Next: /dispute ${dispute.jobId} doc-sent "what you sent back"`
    ].join('\n')
  }
}

function handleDocSent(jobId, descText) {
  const description = parseQuoted(descText)
  if (!description) {
    return {
      handled: true,
      response: 'Usage: /dispute <job-id> doc-sent "description"\nExample: /dispute FD-002 doc-sent "sent moisture logs via email"'
    }
  }

  const data = loadDisputes()
  const dispute = findDispute(data, jobId)
  if (!dispute) {
    return {
      handled: true,
      response: `No open dispute found for ${normalizeJobId(jobId)}.\nUse /dispute ${normalizeJobId(jobId)} "reason" to create one.`
    }
  }

  const now = new Date().toISOString()
  dispute.lastActivityAt = now
  dispute.timeline.push({
    type: 'doc-sent',
    description,
    date: now
  })

  saveDisputes(data)

  const docsSent = dispute.timeline.filter(t => t.type === 'doc-sent').length
  const docsRequested = dispute.timeline.filter(t => t.type === 'doc-requested').length

  return {
    handled: true,
    response: [
      `*${dispute.jobId}* — Doc sent recorded`,
      `Sent: ${description}`,
      `Docs requested: ${docsRequested} | Docs sent: ${docsSent}`,
      '',
      `Clock starts now — Atlas will alert you if no response in ${OVERDUE_DAYS} days.`
    ].join('\n')
  }
}

function handleDisputeResolved(jobId, amountStr) {
  const amount = parseFloat((amountStr || '').replace(/[$,]/g, ''))
  if (isNaN(amount) || amount < 0) {
    return {
      handled: true,
      response: 'Usage: /dispute <job-id> resolved <amount>\nExample: /dispute FD-002 resolved 8500'
    }
  }

  const data = loadDisputes()
  const dispute = findDispute(data, jobId)
  if (!dispute) {
    return {
      handled: true,
      response: `No open dispute found for ${normalizeJobId(jobId)}.`
    }
  }

  const now = new Date().toISOString()
  dispute.status = 'resolved'
  dispute.resolvedAt = now
  dispute.resolvedAmount = amount
  dispute.lastActivityAt = now
  dispute.timeline.push({
    type: 'resolved',
    description: `Settled for ${formatMoney(amount)}`,
    date: now
  })

  saveDisputes(data)

  const daysOpen = daysSince(dispute.createdAt)
  const diff = dispute.invoiceAmount != null
    ? amount - dispute.invoiceAmount
    : null

  return {
    handled: true,
    response: [
      `*${dispute.jobId}* — DISPUTE RESOLVED`,
      `Client: ${dispute.client}`,
      `Settlement: ${formatMoney(amount)}`,
      dispute.invoiceAmount != null ? `Original invoice: ${formatMoney(dispute.invoiceAmount)}` : '',
      diff != null ? `Difference: ${diff >= 0 ? '+' : ''}${formatMoney(diff)}` : '',
      `Open for: ${daysOpen} days`,
      `Timeline events: ${dispute.timeline.length}`
    ].filter(Boolean).join('\n')
  }
}

function handleDisputesList() {
  const data = loadDisputes()
  const open = data.disputes.filter(d => d.status === 'open')

  if (open.length === 0) {
    return { handled: true, response: 'No open disputes. Nice!' }
  }

  // Sort by lastActivityAt (oldest first — most neglected at top)
  open.sort((a, b) => new Date(a.lastActivityAt) - new Date(b.lastActivityAt))

  const lines = [`*Open Disputes* (${open.length})`, '']

  for (const d of open) {
    const waiting = daysSince(d.lastActivityAt)
    const overdue = waiting >= OVERDUE_DAYS ? ' ** OVERDUE **' : ''
    const docsSent = d.timeline.filter(t => t.type === 'doc-sent').length
    const docsRequested = d.timeline.filter(t => t.type === 'doc-requested').length
    const amountStr = d.invoiceAmount != null ? ` | ${formatMoney(d.invoiceAmount)}` : ''

    lines.push(
      `*${d.jobId}* — ${d.client}${amountStr}` +
      `\n  Reason: ${d.reason}` +
      `\n  Adjuster: ${d.adjuster || 'unknown'}` +
      `\n  Docs: ${docsRequested} requested, ${docsSent} sent` +
      `\n  Last activity: ${formatDate(d.lastActivityAt)} (${waiting}d ago)${overdue}`
    )
    lines.push('')
  }

  return { handled: true, response: lines.join('\n').trim() }
}

function handleDisputesOverdue() {
  const data = loadDisputes()
  const open = data.disputes.filter(d => d.status === 'open')
  const overdue = open.filter(d => daysSince(d.lastActivityAt) >= OVERDUE_DAYS)

  if (overdue.length === 0) {
    return { handled: true, response: `No overdue disputes. All responses within ${OVERDUE_DAYS} days.` }
  }

  // Sort by most overdue first
  overdue.sort((a, b) => daysSince(b.lastActivityAt) - daysSince(a.lastActivityAt))

  const lines = [`*Overdue Disputes* (${overdue.length}) — No adjuster response in ${OVERDUE_DAYS}+ days`, '']

  for (const d of overdue) {
    const waiting = daysSince(d.lastActivityAt)
    const lastEvent = d.timeline[d.timeline.length - 1]
    const amountStr = d.invoiceAmount != null ? ` | ${formatMoney(d.invoiceAmount)}` : ''

    lines.push(
      `*${d.jobId}* — ${d.client}${amountStr}` +
      `\n  Waiting: ${waiting} days` +
      `\n  Adjuster: ${d.adjuster || 'unknown'}` +
      `\n  Last: ${lastEvent.type} — ${lastEvent.description}` +
      `\n  Use: /followup ${d.jobId}`
    )
    lines.push('')
  }

  return { handled: true, response: lines.join('\n').trim() }
}

function handleDisputeDetail(jobId) {
  const data = loadDisputes()
  const nid = normalizeJobId(jobId)
  // Find most recent dispute for this job (open first, then resolved)
  const dispute = data.disputes
    .filter(d => d.jobId === nid)
    .sort((a, b) => {
      if (a.status === 'open' && b.status !== 'open') return -1
      if (b.status === 'open' && a.status !== 'open') return 1
      return new Date(b.createdAt) - new Date(a.createdAt)
    })[0]

  if (!dispute) {
    return {
      handled: true,
      response: `No dispute found for ${nid}.\nUse /dispute ${nid} "reason" to create one.`
    }
  }

  const lines = [
    `*${dispute.jobId}* — Dispute ${dispute.status.toUpperCase()}`,
    `Client: ${dispute.client}`,
    `Adjuster: ${dispute.adjuster || 'not set'}${dispute.adjusterEmail ? ' (' + dispute.adjusterEmail + ')' : ''}`,
    `Reason: ${dispute.reason}`,
    dispute.invoiceAmount != null ? `Invoice: ${formatMoney(dispute.invoiceAmount)}` : '',
    `Opened: ${formatDate(dispute.createdAt)}`,
    dispute.resolvedAt ? `Resolved: ${formatDate(dispute.resolvedAt)} for ${formatMoney(dispute.resolvedAmount)}` : '',
    `Last activity: ${formatDate(dispute.lastActivityAt)} (${daysSince(dispute.lastActivityAt)}d ago)`,
    '',
    `--- TIMELINE (${dispute.timeline.length} events) ---`
  ].filter(Boolean)

  for (const event of dispute.timeline) {
    const icon = event.type === 'created' ? 'OPENED'
      : event.type === 'doc-requested' ? 'DOC REQ'
      : event.type === 'doc-sent' ? 'DOC SENT'
      : event.type === 'resolved' ? 'RESOLVED'
      : event.type.toUpperCase()
    lines.push(`${formatDate(event.date)} [${icon}] ${event.description}`)
  }

  return { handled: true, response: lines.join('\n') }
}

function disputeHelp() {
  return {
    handled: true,
    response: [
      '*Adjuster Dispute Tracker*',
      '',
      '/dispute <job-id> "reason" — open dispute',
      '/dispute <job-id> doc-requested "desc" — record adjuster request',
      '/dispute <job-id> doc-sent "desc" — record doc you sent',
      '/dispute <job-id> resolved <amount> — close dispute',
      '/dispute <job-id> — view dispute detail',
      '/disputes — list open disputes',
      '/disputes overdue — adjuster silent 7+ days',
    ].join('\n')
  }
}

// ── Main Router ─────────────────────────────────────────────────────

function routeDisputeCommand(text) {
  const trimmed = text.trim()
  const lower = trimmed.toLowerCase()

  // /disputes [overdue]
  if (lower === '/disputes') return handleDisputesList()
  if (lower === '/disputes overdue') return handleDisputesOverdue()

  // Must start with /dispute
  if (!lower.startsWith('/dispute')) return null

  // Strip "/dispute " prefix
  const rest = trimmed.slice(8).trim()
  if (!rest) return disputeHelp()

  // First token is the job ID
  const spaceIdx = rest.indexOf(' ')
  if (spaceIdx === -1) {
    // Just an ID — show detail
    return handleDisputeDetail(rest)
  }

  const jobId = rest.slice(0, spaceIdx)
  const subRest = rest.slice(spaceIdx + 1).trim()
  const subLower = subRest.toLowerCase()

  // /dispute <id> doc-requested "..."
  if (subLower.startsWith('doc-requested ')) {
    return handleDocRequested(jobId, subRest.slice(14).trim())
  }

  // /dispute <id> doc-sent "..."
  if (subLower.startsWith('doc-sent ')) {
    return handleDocSent(jobId, subRest.slice(9).trim())
  }

  // /dispute <id> resolved <amount>
  if (subLower.startsWith('resolved ')) {
    return handleDisputeResolved(jobId, subRest.slice(9).trim())
  }

  // /dispute <id> "reason" — create dispute (anything else is the reason)
  return handleDisputeCreate(jobId, subRest)
}

// ── Plugin Registration ─────────────────────────────────────────────

export function register(gateway) {
  // Ensure workspace directory exists
  const dir = path.dirname(DISPUTES_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  // Wrap the command handler to intercept /dispute and /disputes
  const originalExecute = gateway.commandHandler.execute.bind(gateway.commandHandler)

  gateway.commandHandler.execute = async function (text, sessionKey, adapter, chatId) {
    const lower = text.trim().toLowerCase()

    if (lower.startsWith('/dispute') || lower.startsWith('/disputes')) {
      const result = routeDisputeCommand(text)
      if (result) return result
    }

    return originalExecute(text, sessionKey, adapter, chatId)
  }

  // Extend /help output
  const originalHelp = gateway.commandHandler.handleHelp.bind(gateway.commandHandler)

  gateway.commandHandler.handleHelp = function () {
    const result = originalHelp()
    const lines = [
      '',
      '--- Adjuster Disputes ---',
      '/dispute <job-id> "reason" — open dispute',
      '/dispute <job-id> doc-requested/doc-sent "desc"',
      '/dispute <job-id> resolved <amount>',
      '/disputes — list open | /disputes overdue'
    ]
    result.response += '\n' + lines.join('\n')
    return result
  }

  console.log('[AdjusterTracker] Loaded — /dispute, /disputes commands enabled')
}
