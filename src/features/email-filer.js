import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

/**
 * Email Auto-Filer Feature
 * Cron (every 15 min): checks work email for messages with attachments.
 * Downloads attachments, matches to a job by client name/subject,
 * uploads to the job's Google Drive folder, logs activity,
 * and sends WhatsApp notification to Frank.
 *
 * Uses gws-work.sh for work email (frankd@flooddoctorva.com)
 * Uses gws CLI for personal Google Drive
 */

import config from '../config.js'

const GWS = config.paths.gwsBin
const GWS_WORK = config.paths.gwsWorkScript
const JOBS_FILE = config.paths.jobsFile
const STATE_FILE = config.paths.emailFilerState
const TEMP_DIR = config.paths.emailFilerTemp
const FRANK_CHAT_ID = '17034981581@s.whatsapp.net'
const CHECK_INTERVAL = 15 * 60 * 1000 // 15 minutes

// Quiet hours: no WhatsApp alerts before 10am (Frank sleeps until ~10-11am)
const QUIET_HOUR_START = 0
const QUIET_HOUR_END = 10

// ── Shell helpers ───────────────────────────────────────────────────

function run(cmd, timeoutMs = 30000) {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: timeoutMs }).trim()
  } catch (err) {
    console.error('[EmailFiler] Command failed:', err.message)
    return null
  }
}

function parseJSON(raw) {
  if (!raw) return null
  try {
    const jsonStart = raw.indexOf('{')
    const jsonArrayStart = raw.indexOf('[')
    const start = jsonStart === -1 ? jsonArrayStart
      : jsonArrayStart === -1 ? jsonStart
      : Math.min(jsonStart, jsonArrayStart)
    if (start === -1) return null
    return JSON.parse(raw.slice(start))
  } catch {
    return null
  }
}

// ── Storage ─────────────────────────────────────────────────────────

function loadJobs() {
  try {
    if (fs.existsSync(JOBS_FILE)) {
      return JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'))
    }
  } catch (err) {
    console.error('[EmailFiler] Failed to load jobs:', err.message)
  }
  return { nextId: 1, jobs: [] }
}

function saveJobs(data) {
  const dir = path.dirname(JOBS_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(JOBS_FILE, JSON.stringify(data, null, 2))
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
    }
  } catch {}
  return { lastCheck: null, processedIds: [] }
}

function saveState(state) {
  try {
    // Keep only last 500 processed IDs
    state.processedIds = state.processedIds.slice(-500)
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
  } catch (err) {
    console.error('[EmailFiler] Failed to save state:', err.message)
  }
}

// ── Job matching ────────────────────────────────────────────────────

/**
 * Match email sender/subject to a job by client name.
 * Returns the best matching job or null.
 */
function matchEmailToJob(from, subject) {
  const data = loadJobs()
  const combined = `${from || ''} ${subject || ''}`.toLowerCase()

  let bestMatch = null
  let bestScore = 0

  for (const job of data.jobs) {
    if (!job.client) continue
    // Split client name into words for matching
    const clientWords = job.client.toLowerCase().split(/\s+/)

    let score = 0
    for (const word of clientWords) {
      if (word.length < 3) continue // skip short words like "&"
      if (combined.includes(word)) {
        score += word.length // longer name matches score higher
      }
    }

    // Also check for job ID in subject (FD-002, FD002, etc.)
    if (job.id) {
      const idClean = job.id.replace('-', '')
      if (combined.includes(job.id.toLowerCase()) || combined.includes(idClean.toLowerCase())) {
        score += 100 // exact job ID match is a strong signal
      }
    }

    if (score > bestScore) {
      bestScore = score
      bestMatch = job
    }
  }

  // Require a minimum match quality (at least one meaningful name word)
  return bestScore >= 3 ? bestMatch : null
}

// ── Email checking ──────────────────────────────────────────────────

/**
 * Search for recent unread emails with attachments
 */
function findEmailsWithAttachments(state) {
  const query = 'is:unread has:attachment newer_than:1h'
  const raw = run(`${GWS_WORK} gmail users messages list --params '{"userId":"me","q":"${query}","maxResults":10}'`)
  const parsed = parseJSON(raw)
  if (!parsed) return []

  const messages = parsed.messages || parsed || []
  if (!Array.isArray(messages)) return []

  const results = []

  for (const msg of messages) {
    const id = msg.id
    if (!id || state.processedIds.includes(id)) continue

    // Get full message details
    const detail = run(`${GWS_WORK} gmail users messages get --id "${id}" --format full`)
    const msgData = parseJSON(detail)
    if (!msgData) continue

    const headers = msgData.payload?.headers || []
    const from = headers.find(h => h.name === 'From')?.value || ''
    const subject = headers.find(h => h.name === 'Subject')?.value || ''

    // Find attachment parts
    const attachments = []
    findAttachmentParts(msgData.payload, attachments)

    if (attachments.length > 0) {
      results.push({
        id,
        from: from.replace(/<[^>]+>/, '').trim(),
        fromRaw: from,
        subject: subject.substring(0, 200),
        attachments
      })
    }
  }

  return results
}

/**
 * Recursively find attachment parts in a Gmail message payload
 */
function findAttachmentParts(part, results) {
  if (!part) return

  if (part.filename && part.filename.length > 0 && part.body?.attachmentId) {
    results.push({
      filename: part.filename,
      mimeType: part.mimeType || 'application/octet-stream',
      attachmentId: part.body.attachmentId,
      size: part.body.size || 0
    })
  }

  // Check child parts
  if (part.parts) {
    for (const child of part.parts) {
      findAttachmentParts(child, results)
    }
  }
}

/**
 * Download an attachment from Gmail
 */
function downloadAttachment(messageId, attachmentId, filename) {
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true })
  }

  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 100)
  const outputPath = path.join(TEMP_DIR, safeName)

  // Get the attachment data
  const raw = run(
    `${GWS_WORK} gmail users messages attachments get --messageId "${messageId}" --id "${attachmentId}"`,
    60000
  )
  const parsed = parseJSON(raw)
  if (!parsed || !parsed.data) return null

  // Gmail returns base64url-encoded data
  const base64Data = parsed.data.replace(/-/g, '+').replace(/_/g, '/')
  const buffer = Buffer.from(base64Data, 'base64')
  fs.writeFileSync(outputPath, buffer)

  return outputPath
}

/**
 * Upload a file to a Google Drive folder
 */
function uploadToDrive(filePath, folderId, filename) {
  try {
    const result = run(
      `${GWS} drive files create --name "${filename}" --parents "${folderId}" --upload "${filePath}"`,
      60000
    )
    return result != null
  } catch {
    return false
  }
}

// ── Cleanup ─────────────────────────────────────────────────────────

function cleanupTemp() {
  try {
    if (fs.existsSync(TEMP_DIR)) {
      fs.rmSync(TEMP_DIR, { recursive: true, force: true })
    }
  } catch {}
}

// ── Quiet hours ─────────────────────────────────────────────────────

function isQuietHours() {
  const hour = new Date().getHours()
  return hour >= QUIET_HOUR_START && hour < QUIET_HOUR_END
}

// ── Main processing ─────────────────────────────────────────────────

async function processEmails(gateway) {
  const state = loadState()
  const emails = findEmailsWithAttachments(state)

  if (emails.length === 0) {
    state.lastCheck = new Date().toISOString()
    saveState(state)
    return
  }

  const adapter = gateway.adapters.get('whatsapp')
  const notifications = []

  for (const email of emails) {
    const job = matchEmailToJob(email.from, email.subject)

    for (const att of email.attachments) {
      // Download attachment
      const localPath = downloadAttachment(email.id, att.attachmentId, att.filename)
      if (!localPath) {
        console.error(`[EmailFiler] Failed to download: ${att.filename} from "${email.subject}"`)
        continue
      }

      if (job && job.driveFolderId) {
        // Upload to job's Drive folder
        const uploaded = uploadToDrive(localPath, job.driveFolderId, att.filename)
        if (uploaded) {
          const logMsg = `${email.from} sent ${att.filename} for ${job.client} (${job.id}). Filed in Drive.`
          console.log(`[EmailFiler] ${logMsg}`)

          // Add note to job
          const data = loadJobs()
          const jobRef = data.jobs.find(j => j.id === job.id)
          if (jobRef) {
            if (!Array.isArray(jobRef.notes)) jobRef.notes = []
            jobRef.notes.push({
              text: `Auto-filed: ${att.filename} from ${email.from}`,
              date: new Date().toISOString()
            })
            saveJobs(data)
          }

          notifications.push(logMsg)
        } else {
          console.error(`[EmailFiler] Upload failed: ${att.filename} -> ${job.id} Drive folder`)
          notifications.push(`${email.from} sent ${att.filename} — matched to ${job.id} (${job.client}) but Drive upload FAILED.`)
        }
      } else {
        // No job match — still log it
        const logMsg = `${email.from} sent ${att.filename} (subject: "${email.subject}") — no job match found.`
        console.log(`[EmailFiler] ${logMsg}`)
        notifications.push(logMsg)
      }
    }

    // Mark as processed
    state.processedIds.push(email.id)
  }

  state.lastCheck = new Date().toISOString()
  saveState(state)

  // Clean up temp files
  cleanupTemp()

  // Send WhatsApp notification (batch all into one message)
  if (notifications.length > 0 && adapter && !isQuietHours()) {
    const lines = ['*Atlas Email Filer*', '']
    for (const n of notifications) {
      lines.push(`- ${n}`)
    }

    try {
      await adapter.sendMessage(FRANK_CHAT_ID, lines.join('\n'))
      console.log(`[EmailFiler] Sent ${notifications.length} notification(s) to Frank`)
    } catch (err) {
      console.error('[EmailFiler] WhatsApp notification failed:', err.message)
    }
  } else if (notifications.length > 0 && isQuietHours()) {
    console.log(`[EmailFiler] ${notifications.length} item(s) processed but quiet hours — no WhatsApp alert`)
  }
}

// ── Plugin Registration ─────────────────────────────────────────────

export function register(gateway) {
  // Ensure temp directory exists
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true })
  }

  // Run every 15 minutes
  const timer = setInterval(() => {
    processEmails(gateway).catch(err => {
      console.error('[EmailFiler] Process error:', err.message)
    })
  }, CHECK_INTERVAL)

  // Initial check after 3 minutes (let WhatsApp connect first)
  setTimeout(() => {
    processEmails(gateway).catch(err => {
      console.error('[EmailFiler] Initial check error:', err.message)
    })
  }, 3 * 60 * 1000)

  gateway._emailFilerTimer = timer

  console.log('[EmailFiler] Loaded — auto-filing attachments every 15 min')
}
