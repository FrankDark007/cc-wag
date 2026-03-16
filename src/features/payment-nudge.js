import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

/**
 * Payment Nudge Feature
 * Command: /nudge FD-002
 *
 * Sends a professional payment reminder email from frank@flood.doctor
 * to the client using the Flood Doctor branded HTML template.
 * Records nudge date in job notes.
 *
 * Requirements:
 *   - Job must be status: invoiced or payment-pending
 *   - Job must have clientEmail set
 *   - Uses gws-work.sh to send email from frankd@flooddoctorva.com
 */

const GWS_WORK = '/Users/ghost/Projects/cc-wag/scripts/gws-work.sh'
const JOBS_FILE = '/Users/ghost/Projects/cc-wag/workspace/jobs.json'
const TEMPLATE_FILE = '/Users/ghost/Projects/cc-wag/config/email-templates/flood-doctor.html'
const FRANK_CHAT_ID = '17034981581@s.whatsapp.net'

const NUDGE_ELIGIBLE_STATUSES = ['invoiced', 'payment-pending']

// ── Storage ─────────────────────────────────────────────────────────

function loadJobs() {
  try {
    if (fs.existsSync(JOBS_FILE)) {
      return JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'))
    }
  } catch (err) {
    console.error('[PaymentNudge] Failed to load jobs:', err.message)
  }
  return { nextId: 1, jobs: [] }
}

function saveJobs(data) {
  const dir = path.dirname(JOBS_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(JOBS_FILE, JSON.stringify(data, null, 2))
}

function findJob(data, idStr) {
  const upper = idStr.toUpperCase()
  return data.jobs.find(j => {
    if (j.id === upper) return true
    const num = parseInt(idStr, 10)
    if (!isNaN(num) && j.id === `FD-${String(num).padStart(3, '0')}`) return true
    return false
  })
}

// ── Helpers ──────────────────────────────────────────────────────────

function formatMoney(amount) {
  if (amount == null) return 'the outstanding balance'
  return '$' + Number(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

function formatDate(isoStr) {
  if (!isoStr) return ''
  return new Date(isoStr).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  })
}

function daysSince(isoStr) {
  if (!isoStr) return 0
  return Math.floor((Date.now() - new Date(isoStr).getTime()) / (1000 * 60 * 60 * 24))
}

// ── Email template ──────────────────────────────────────────────────

function buildNudgeEmail(job) {
  let template
  try {
    template = fs.readFileSync(TEMPLATE_FILE, 'utf-8')
  } catch (err) {
    console.error('[PaymentNudge] Template read failed:', err.message)
    return null
  }

  const clientName = job.client || 'Valued Client'
  const amount = formatMoney(job.invoiceAmount)
  const invoiceDate = job.invoiceDate ? formatDate(job.invoiceDate) : 'recently'
  const daysOverdue = job.invoiceDate ? daysSince(job.invoiceDate) : 0
  const address = job.address ? `${job.address}${job.city ? ', ' + job.city : ''}` : 'your property'

  const greeting = `Hi ${clientName},`

  const body1 = `I hope this message finds you well. I am writing to follow up on the outstanding invoice for the water damage restoration services completed at ${address}. The invoice of ${amount} was issued on ${invoiceDate}${daysOverdue > 30 ? ` (${daysOverdue} days ago)` : ''}.`

  const body2 = `We understand that processing payments can take time, and we appreciate your attention to this matter. If you have already submitted the payment, please disregard this reminder. Otherwise, we kindly ask that you process the payment at your earliest convenience.`

  const body3 = `If you have any questions about the invoice or need to discuss payment arrangements, please do not hesitate to reach out. We are here to help and want to ensure a smooth resolution.`

  // Replace template placeholders
  const html = template
    .replace('[Client Name]', clientName)
    .replace(
      '[Your primary message goes here. Keep paragraphs relatively short to ensure they are easy to scan on mobile devices. You can use this space for project updates, estimates, or follow-ups.]',
      body1
    )
    .replace(
      '[Optional second paragraph for next steps or calls to action.]',
      `${body2}</p>\n\n    <p style="font-size: 15px; line-height: 1.7; color: #374151;">${body3}`
    )

  const subject = `Payment Reminder — Flood Doctor Invoice${job.invoiceAmount ? ` (${amount})` : ''}`

  return { html, subject, greeting }
}

// ── Send email via gws ──────────────────────────────────────────────

function sendNudgeEmail(toEmail, subject, htmlBody) {
  try {
    // Build raw MIME email
    const boundary = 'boundary_' + Date.now()
    const rawEmail = [
      `To: ${toEmail}`,
      `From: "Flood Doctor" <frankd@flooddoctorva.com>`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      '',
      'Please view this email in an HTML-capable client for the best experience.',
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      '',
      htmlBody,
      '',
      `--${boundary}--`
    ].join('\r\n')

    // Base64url encode the raw email
    const encoded = Buffer.from(rawEmail)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')

    // Write to temp file to avoid shell escaping issues
    const tempFile = '/Users/ghost/Projects/cc-wag/workspace/nudge-email-temp.json'
    fs.writeFileSync(tempFile, JSON.stringify({ raw: encoded }))

    const result = execSync(
      `${GWS_WORK} gmail users messages send --raw "${encoded}"`,
      { encoding: 'utf-8', timeout: 30000 }
    )

    // Clean up temp file
    try { fs.unlinkSync(tempFile) } catch {}

    return result != null
  } catch (err) {
    console.error('[PaymentNudge] Send failed:', err.message)
    return false
  }
}

// ── Command handler ─────────────────────────────────────────────────

function handleNudge(idStr) {
  if (!idStr) {
    return {
      handled: true,
      response: [
        '*Payment Nudge*',
        '',
        'Usage: /nudge <job-id>',
        'Example: /nudge FD-002',
        '',
        'Sends a professional payment reminder email to the client.',
        'Job must be status: invoiced or payment-pending.',
        'Job must have a clientEmail set.',
      ].join('\n')
    }
  }

  const data = loadJobs()
  const job = findJob(data, idStr)

  if (!job) {
    return { handled: true, response: `Job not found: ${idStr}` }
  }

  if (!NUDGE_ELIGIBLE_STATUSES.includes(job.status)) {
    return {
      handled: true,
      response: `${job.id} (${job.client}) is status: ${job.status}.\nNudge only works for: ${NUDGE_ELIGIBLE_STATUSES.join(', ')}.`
    }
  }

  if (!job.clientEmail) {
    return {
      handled: true,
      response: `${job.id} (${job.client}) has no clientEmail set.\n\nAdd one first:\n/job ${job.id} note clientEmail: client@example.com\n\nOr update jobs.json directly.`
    }
  }

  // Build the email
  const email = buildNudgeEmail(job)
  if (!email) {
    return { handled: true, response: 'Failed to build email template.' }
  }

  // Send
  const sent = sendNudgeEmail(job.clientEmail, email.subject, email.html)
  if (!sent) {
    return { handled: true, response: `Failed to send nudge email to ${job.clientEmail}. Check logs.` }
  }

  // Record nudge in job notes
  if (!Array.isArray(job.notes)) job.notes = []
  job.notes.push({
    text: `Payment nudge sent to ${job.clientEmail}`,
    date: new Date().toISOString()
  })

  // Update status to payment-pending if it was just invoiced
  if (job.status === 'invoiced') {
    job.status = 'payment-pending'
  }

  saveJobs(data)

  const daysOverdue = job.invoiceDate ? daysSince(job.invoiceDate) : 0
  const lines = [
    `Payment nudge sent for *${job.id}* (${job.client})`,
    `To: ${job.clientEmail}`,
    `Amount: ${formatMoney(job.invoiceAmount)}`,
  ]
  if (daysOverdue > 0) lines.push(`Invoice age: ${daysOverdue} days`)
  if (job.status === 'payment-pending') lines.push('Status updated to: payment-pending')

  return { handled: true, response: lines.join('\n') }
}

// ── Plugin Registration ─────────────────────────────────────────────

export function register(gateway) {
  // Wrap the command handler to intercept /nudge
  const originalExecute = gateway.commandHandler.execute.bind(gateway.commandHandler)

  gateway.commandHandler.execute = async function (text, sessionKey, adapter, chatId) {
    const lower = text.trim().toLowerCase()

    if (lower.startsWith('/nudge')) {
      const rest = text.trim().slice(6).trim()
      const result = handleNudge(rest)
      if (result) return result
    }

    return originalExecute(text, sessionKey, adapter, chatId)
  }

  // Extend /help output
  const originalHelp = gateway.commandHandler.handleHelp.bind(gateway.commandHandler)

  gateway.commandHandler.handleHelp = function () {
    const result = originalHelp()
    const nudgeLines = [
      '',
      '--- Payment Nudge ---',
      '/nudge <job-id> — Send payment reminder email to client',
    ]
    result.response += '\n' + nudgeLines.join('\n')
    return result
  }

  console.log('[PaymentNudge] Loaded — /nudge command enabled')
}
