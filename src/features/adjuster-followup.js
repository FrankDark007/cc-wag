import fs from 'fs'
import { execSync } from 'child_process'

/**
 * Adjuster Follow-up Automation Feature
 * Cron: checks disputes where adjuster silent 7+ days, alerts Frank
 * Command: /followup <job-id> — draft and send follow-up email
 *
 * Schedule: 12pm, 4pm, 8pm, midnight (no alerts before 10am)
 * Uses gws-work.sh to send from frank@flood.doctor
 */

const DISPUTES_FILE = '/Users/ghost/Projects/cc-wag/workspace/disputes.json'
const JOBS_FILE = '/Users/ghost/Projects/cc-wag/workspace/jobs.json'
const GWS_WORK = '/Users/ghost/Projects/cc-wag/scripts/gws-work.sh'
const FRANK_CHAT_ID = '17034981581@s.whatsapp.net'

const OVERDUE_DAYS = 7
const MS_PER_DAY = 86400000

// Cron hours: 12pm, 4pm, 8pm, midnight — never before 10am
const CRON_HOURS = [12, 16, 20, 0]

// ── Storage ─────────────────────────────────────────────────────────

function loadDisputes() {
  try {
    if (fs.existsSync(DISPUTES_FILE)) {
      return JSON.parse(fs.readFileSync(DISPUTES_FILE, 'utf-8'))
    }
  } catch (err) {
    console.error('[AdjusterFollowup] Failed to load disputes:', err.message)
  }
  return { disputes: [] }
}

function saveDisputes(data) {
  fs.writeFileSync(DISPUTES_FILE, JSON.stringify(data, null, 2))
}

function loadJobs() {
  try {
    if (fs.existsSync(JOBS_FILE)) {
      return JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'))
    }
  } catch (err) {
    console.error('[AdjusterFollowup] Failed to load jobs:', err.message)
  }
  return { nextId: 1, jobs: [] }
}

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

// ── Helpers ─────────────────────────────────────────────────────────

function normalizeJobId(jobId) {
  const upper = jobId.toUpperCase()
  if (upper.startsWith('FD-')) return upper
  const num = parseInt(jobId, 10)
  if (!isNaN(num)) return `FD-${String(num).padStart(3, '0')}`
  return upper
}

function daysSince(isoStr) {
  if (!isoStr) return Infinity
  return Math.floor((Date.now() - new Date(isoStr).getTime()) / MS_PER_DAY)
}

function formatDate(isoStr) {
  if (!isoStr) return '—'
  return new Date(isoStr).toLocaleDateString('en-US', {
    month: 'long',
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

function getOverdueDisputes() {
  const data = loadDisputes()
  return data.disputes.filter(d =>
    d.status === 'open' && daysSince(d.lastActivityAt) >= OVERDUE_DAYS
  )
}

// ── Email Drafting ──────────────────────────────────────────────────

function buildFollowupEmail(dispute, job) {
  const daysWaiting = daysSince(dispute.lastActivityAt)
  const docsSent = dispute.timeline.filter(t => t.type === 'doc-sent')
  const docsRequested = dispute.timeline.filter(t => t.type === 'doc-requested')

  const adjusterName = dispute.adjuster || 'Claims Adjuster'
  const adjusterFirst = adjusterName.split(' ')[0]

  // Build document summary
  const docLines = []
  for (const doc of docsSent) {
    docLines.push(`- ${doc.description} (sent ${formatDate(doc.date)})`)
  }

  const invoiceLine = dispute.invoiceAmount != null
    ? `Our invoice of ${formatMoney(dispute.invoiceAmount)}${dispute.invoiceDate ? ' dated ' + formatDate(dispute.invoiceDate) : ''}`
    : 'Our invoice for this claim'

  const subject = `Follow-Up: ${job ? job.client : dispute.client} — Claim ${dispute.jobId} — ${daysWaiting} Days Without Response`

  const body = [
    `Dear ${adjusterFirst},`,
    '',
    `I am writing to follow up on the claim for ${dispute.client}${job && job.address ? ' at ' + job.address + (job.city ? ', ' + job.city : '') : ''}.`,
    '',
    `${invoiceLine} was submitted along with all requested supporting documentation. It has now been ${daysWaiting} days since our last correspondence, and we have not received a response.`,
    '',
  ]

  if (docsSent.length > 0) {
    body.push('The following documents have been provided:')
    for (const line of docLines) {
      body.push(line)
    }
    body.push('')
  }

  if (docsRequested.length > 0) {
    const unanswered = docsRequested.filter(req => {
      // Check if there's a doc-sent after this request
      const reqDate = new Date(req.date)
      return !docsSent.some(sent => new Date(sent.date) > reqDate)
    })
    if (unanswered.length > 0) {
      body.push('We note the following outstanding requests:')
      for (const req of unanswered) {
        body.push(`- ${req.description} (requested ${formatDate(req.date)})`)
      }
      body.push('')
    }
  }

  body.push(
    'We respectfully request a prompt review and response regarding this claim. Continued delays in processing affect our ability to serve our mutual policyholders and may necessitate further action to resolve this matter.',
    '',
    'Please contact me at your earliest convenience to discuss.',
    '',
    'Respectfully,',
    'Frank Darakhshan',
    'President, Flood Doctor LLC',
    'Phone: (703) 498-1581',
    'Email: frank@flood.doctor'
  )

  return { subject, body: body.join('\n') }
}

/**
 * Send follow-up email via gws-work.sh
 */
function sendFollowupEmail(toEmail, subject, body) {
  try {
    // Use gws-work.sh to send from frank@flood.doctor
    // Escape special chars for shell
    const escapedSubject = subject.replace(/'/g, "'\\''")
    const escapedBody = body.replace(/'/g, "'\\''")
    const escapedTo = toEmail.replace(/'/g, "'\\''")

    const cmd = `${GWS_WORK} gmail messages send --to '${escapedTo}' --subject '${escapedSubject}' --body '${escapedBody}'`

    const result = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 30000
    })

    console.log(`[AdjusterFollowup] Email sent to ${toEmail}: ${result.trim().substring(0, 100)}`)
    return { success: true, output: result.trim() }
  } catch (err) {
    console.error(`[AdjusterFollowup] Email send failed:`, err.message)
    return { success: false, error: err.message }
  }
}

// ── Command Handler ─────────────────────────────────────────────────

function handleFollowup(jobId) {
  const nid = normalizeJobId(jobId)
  const data = loadDisputes()
  const dispute = data.disputes.find(d => d.jobId === nid && d.status === 'open')

  if (!dispute) {
    return {
      handled: true,
      response: `No open dispute for ${nid}.\nUse /dispute ${nid} "reason" to create one first.`
    }
  }

  if (!dispute.adjusterEmail) {
    // Check if job has email
    const job = findJob(jobId)
    if (job && job.adjusterEmail) {
      dispute.adjusterEmail = job.adjusterEmail
      dispute.adjuster = dispute.adjuster || job.adjuster
      saveDisputes(data)
    } else {
      return {
        handled: true,
        response: `No adjuster email for ${nid}.\nUse /job ${nid} adjuster <name> <email> to set it first.`
      }
    }
  }

  const job = findJob(jobId)
  const { subject, body } = buildFollowupEmail(dispute, job)
  const daysWaiting = daysSince(dispute.lastActivityAt)

  // Show draft first
  const preview = [
    `*Follow-up Email Draft for ${nid}*`,
    '',
    `To: ${dispute.adjusterEmail}`,
    `Subject: ${subject}`,
    '',
    '--- PREVIEW ---',
    body.substring(0, 500) + (body.length > 500 ? '...' : ''),
    '--- END PREVIEW ---',
    '',
  ]

  // Send it
  const result = sendFollowupEmail(dispute.adjusterEmail, subject, body)

  if (result.success) {
    // Record in timeline
    const now = new Date().toISOString()
    dispute.lastActivityAt = now
    dispute.timeline.push({
      type: 'followup-sent',
      description: `Follow-up email sent to ${dispute.adjusterEmail} (${daysWaiting} days waiting)`,
      date: now
    })
    saveDisputes(data)

    preview.push(`Email SENT to ${dispute.adjusterEmail}`)
    preview.push(`Clock resets — Atlas will alert again in ${OVERDUE_DAYS} days if no response.`)
  } else {
    preview.push(`SEND FAILED: ${result.error}`)
    preview.push(`\nFix the issue and try /followup ${nid} again.`)
  }

  return { handled: true, response: preview.join('\n') }
}

function followupHelp() {
  return {
    handled: true,
    response: [
      '*Adjuster Follow-up*',
      '',
      '/followup <job-id> — draft and send follow-up email to adjuster',
      '',
      'Requires: open dispute + adjuster email on file',
      'Sends from: frank@flood.doctor via gws-work.sh',
      'Tone: professional, firm, cites all docs and wait time',
    ].join('\n')
  }
}

// ── Cron: Overdue Alert ─────────────────────────────────────────────

function buildOverdueAlert(overdueDisputes) {
  if (overdueDisputes.length === 0) return null

  // Sort by most overdue
  overdueDisputes.sort((a, b) => daysSince(b.lastActivityAt) - daysSince(a.lastActivityAt))

  const lines = [
    `*Adjuster Follow-up Needed* — ${overdueDisputes.length} dispute${overdueDisputes.length > 1 ? 's' : ''} with no response in ${OVERDUE_DAYS}+ days`,
    ''
  ]

  for (const d of overdueDisputes) {
    const waiting = daysSince(d.lastActivityAt)
    const amountStr = d.invoiceAmount != null ? ` | ${formatMoney(d.invoiceAmount)}` : ''
    lines.push(
      `*${d.jobId}* — ${d.client}${amountStr}` +
      `\n  ${waiting} days waiting | Adjuster: ${d.adjuster || 'unknown'}` +
      `\n  /followup ${d.jobId}`
    )
    lines.push('')
  }

  return lines.join('\n').trim()
}

// ── Plugin Registration ─────────────────────────────────────────────

export function register(gateway) {
  // Wrap command handler for /followup
  const originalExecute = gateway.commandHandler.execute.bind(gateway.commandHandler)

  gateway.commandHandler.execute = async function (text, sessionKey, adapter, chatId) {
    const trimmed = text.trim()
    const lower = trimmed.toLowerCase()

    if (lower === '/followup') {
      return followupHelp()
    }

    if (lower.startsWith('/followup ')) {
      const jobId = trimmed.slice(10).trim()
      if (!jobId) return followupHelp()
      return handleFollowup(jobId)
    }

    return originalExecute(text, sessionKey, adapter, chatId)
  }

  // Extend /help
  const originalHelp = gateway.commandHandler.handleHelp.bind(gateway.commandHandler)

  gateway.commandHandler.handleHelp = function () {
    const result = originalHelp()
    result.response += '\n\n--- Adjuster Follow-up ---\n/followup <job-id> — send follow-up email to adjuster'
    return result
  }

  // --- Cron: Check overdue disputes at 12pm, 4pm, 8pm, midnight ---
  const alertedToday = new Set()
  let lastAlertDate = null

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

    // Only fire at exact cron hours, minute 0
    if (!CRON_HOURS.includes(hour) || minute !== 0) return

    // No alerts before 10am (constraint)
    if (hour < 10) return

    // Dedupe per hour
    const hourKey = `followup-check:${todayStr}:${hour}`
    if (alertedToday.has(hourKey)) return
    alertedToday.add(hourKey)

    const overdue = getOverdueDisputes()
    if (overdue.length === 0) {
      console.log(`[AdjusterFollowup] ${hour}:00 check — no overdue disputes`)
      return
    }

    // Filter out disputes we already alerted about today
    const newAlerts = overdue.filter(d => {
      const key = `followup-alert:${d.jobId}:${todayStr}`
      if (alertedToday.has(key)) return false
      alertedToday.add(key)
      return true
    })

    if (newAlerts.length === 0) return

    const alertMsg = buildOverdueAlert(newAlerts)
    if (!alertMsg) return

    const adapter = gateway.adapters.get('whatsapp')
    if (!adapter) {
      console.log('[AdjusterFollowup] No WhatsApp adapter, skipping alert')
      return
    }

    console.log(`[AdjusterFollowup] ${hour}:00 — alerting on ${newAlerts.length} overdue dispute(s)`)
    adapter.sendMessage(FRANK_CHAT_ID, alertMsg)
      .then(() => console.log('[AdjusterFollowup] Overdue alert sent'))
      .catch(err => console.error('[AdjusterFollowup] Alert send failed:', err.message))
  }, 60000) // Check every minute

  gateway._adjusterFollowupTimer = timer

  console.log('[AdjusterFollowup] Loaded — /followup command, cron at 12pm/4pm/8pm/midnight (no alerts before 10am)')
}
