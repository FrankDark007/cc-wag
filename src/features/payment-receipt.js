import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

/**
 * Payment Receipt Feature
 * Command: /receipt FD-002
 *
 * Generates and sends a branded payment receipt email to the client.
 * Job must be status: paid with a payment amount.
 * If no clientEmail, tells Frank to add one.
 * Records receipt sent in job notes.
 *
 * Uses gws-work.sh to send from frankd@flooddoctorva.com
 */

const GWS_WORK = '/Users/ghost/Projects/cc-wag/scripts/gws-work.sh'
const JOBS_FILE = '/Users/ghost/Projects/cc-wag/workspace/jobs.json'
const TEMPLATE_FILE = '/Users/ghost/Projects/cc-wag/config/email-templates/flood-doctor.html'
const FRANK_CHAT_ID = '17034981581@s.whatsapp.net'

// ── Storage ─────────────────────────────────────────────────────────

function loadJobs() {
  try {
    if (fs.existsSync(JOBS_FILE)) {
      return JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'))
    }
  } catch (err) {
    console.error('[PaymentReceipt] Failed to load jobs:', err.message)
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
  if (amount == null) return '$0.00'
  return '$' + Number(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

function formatDate(isoStr) {
  if (!isoStr) return new Date().toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric'
  })
  return new Date(isoStr).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric'
  })
}

// ── Receipt email ───────────────────────────────────────────────────

function buildReceiptEmail(job) {
  let template
  try {
    template = fs.readFileSync(TEMPLATE_FILE, 'utf-8')
  } catch (err) {
    console.error('[PaymentReceipt] Template read failed:', err.message)
    return null
  }

  const clientName = job.client || 'Valued Client'
  const amount = formatMoney(job.invoiceAmount)
  const paymentDate = formatDate(job.paymentDate)
  const address = job.address ? `${job.address}${job.city ? ', ' + job.city : ''}` : 'your property'

  const body1 = `Thank you for your payment of ${amount} received on ${paymentDate} for the water damage restoration services at ${address}. This email serves as your official payment receipt.`

  const body2 = `Your account is now paid in full. We appreciate your prompt attention to this matter and it was a pleasure working with you. Should you need any restoration services in the future, please do not hesitate to contact us — we are available 24/7 for emergency response.</p>\n\n    <p style="font-size: 15px; line-height: 1.7; color: #374151;"><strong>Receipt Summary:</strong><br>Job Reference: ${job.id}<br>Service: Water Damage Restoration<br>Location: ${address}<br>Amount Paid: ${amount}<br>Payment Date: ${paymentDate}<br>Status: <span style="color: #16a34a; font-weight: 600;">PAID IN FULL</span>`

  // Replace template placeholders
  const html = template
    .replace('[Client Name]', clientName)
    .replace(
      '[Your primary message goes here. Keep paragraphs relatively short to ensure they are easy to scan on mobile devices. You can use this space for project updates, estimates, or follow-ups.]',
      body1
    )
    .replace(
      '[Optional second paragraph for next steps or calls to action.]',
      body2
    )

  const subject = `Payment Receipt — Flood Doctor ${job.id} (${amount})`

  return { html, subject }
}

// ── Send email via gws ──────────────────────────────────────────────

function sendReceiptEmail(toEmail, subject, htmlBody) {
  try {
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

    const encoded = Buffer.from(rawEmail)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')

    execSync(
      `${GWS_WORK} gmail users messages send --raw "${encoded}"`,
      { encoding: 'utf-8', timeout: 30000 }
    )

    return true
  } catch (err) {
    console.error('[PaymentReceipt] Send failed:', err.message)
    return false
  }
}

// ── Command handler ─────────────────────────────────────────────────

function handleReceipt(idStr) {
  if (!idStr) {
    return {
      handled: true,
      response: [
        '*Payment Receipt*',
        '',
        'Usage: /receipt <job-id>',
        'Example: /receipt FD-002',
        '',
        'Sends a branded payment receipt email to the client.',
        'Job must be status: paid with a payment amount.',
        'Job must have a clientEmail set.',
      ].join('\n')
    }
  }

  const data = loadJobs()
  const job = findJob(data, idStr)

  if (!job) {
    return { handled: true, response: `Job not found: ${idStr}` }
  }

  if (job.status !== 'paid') {
    return {
      handled: true,
      response: `${job.id} (${job.client}) is status: ${job.status}.\nReceipt requires status: paid.\n\nMark it paid first: /job ${job.id} paid`
    }
  }

  if (job.invoiceAmount == null) {
    return {
      handled: true,
      response: `${job.id} (${job.client}) has no invoice amount recorded.\n\nSet it first: /job ${job.id} invoice <amount>`
    }
  }

  if (!job.clientEmail) {
    return {
      handled: true,
      response: `${job.id} (${job.client}) has no clientEmail set.\n\nAdd the client's email to send a receipt. Update jobs.json or add a note:\n/job ${job.id} note clientEmail: client@example.com`
    }
  }

  // Check if receipt was already sent
  const alreadySent = (job.notes || []).some(n =>
    n.text && n.text.includes('Payment receipt sent')
  )
  if (alreadySent) {
    // Allow resend but warn
    // (don't block — Frank may need to resend)
  }

  // Build and send receipt
  const email = buildReceiptEmail(job)
  if (!email) {
    return { handled: true, response: 'Failed to build receipt template.' }
  }

  const sent = sendReceiptEmail(job.clientEmail, email.subject, email.html)
  if (!sent) {
    return { handled: true, response: `Failed to send receipt to ${job.clientEmail}. Check logs.` }
  }

  // Record receipt in job notes
  if (!Array.isArray(job.notes)) job.notes = []
  job.notes.push({
    text: `Payment receipt sent to ${job.clientEmail} (${formatMoney(job.invoiceAmount)})`,
    date: new Date().toISOString()
  })
  saveJobs(data)

  const lines = [
    `Payment receipt sent for *${job.id}* (${job.client})`,
    `To: ${job.clientEmail}`,
    `Amount: ${formatMoney(job.invoiceAmount)}`,
    `Payment date: ${formatDate(job.paymentDate)}`,
  ]
  if (alreadySent) lines.push('(Note: receipt was sent previously — this is a resend)')

  return { handled: true, response: lines.join('\n') }
}

// ── Plugin Registration ─────────────────────────────────────────────

export function register(gateway) {
  // Wrap command handler to intercept /receipt
  const originalExecute = gateway.commandHandler.execute.bind(gateway.commandHandler)

  gateway.commandHandler.execute = async function (text, sessionKey, adapter, chatId) {
    const lower = text.trim().toLowerCase()

    if (lower.startsWith('/receipt')) {
      const rest = text.trim().slice(8).trim()
      const result = handleReceipt(rest)
      if (result) return result
    }

    return originalExecute(text, sessionKey, adapter, chatId)
  }

  // Extend /help output
  const originalHelp = gateway.commandHandler.handleHelp.bind(gateway.commandHandler)

  gateway.commandHandler.handleHelp = function () {
    const result = originalHelp()
    const receiptLines = [
      '',
      '--- Payment Receipt ---',
      '/receipt <job-id> — Send branded payment receipt to client',
    ]
    result.response += '\n' + receiptLines.join('\n')
    return result
  }

  console.log('[PaymentReceipt] Loaded — /receipt command enabled')
}
