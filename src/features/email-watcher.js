import { execSync } from 'child_process'
import fs from 'fs'

/**
 * Email Triage Alerts Feature
 * Checks work Gmail every 15 minutes for urgent/VIP emails
 * Sends WhatsApp alert only for important senders
 *
 * VIP list: insurance companies, adjusters, attorneys, key clients
 */

import config from '../config.js'

const GWS_WORK = config.paths.gwsWorkScript
const FRANK_CHAT_ID = '17034981581@s.whatsapp.net'
const CHECK_INTERVAL = 15 * 60 * 1000 // 15 minutes
const STATE_FILE = config.paths.emailWatcherState

// VIP sender patterns (case-insensitive regex)
// These senders trigger immediate WhatsApp alerts
const VIP_PATTERNS = [
  /statefarm/i,
  /allstate/i,
  /usaa/i,
  /geico/i,
  /nationwide/i,
  /farmers/i,
  /liberty\s*mutual/i,
  /progressive/i,
  /travelers/i,
  /erie\s*insurance/i,
  /adjuster/i,
  /claims/i,
  /attorney/i,
  /lawyer/i,
  /court/i,
  /dpor/i,
  /virginia\.gov/i,
  /fairfax/i,
  /arlington/i,
  /loudoun/i,
  /prince\s*william/i,
  /emergency/i,
  /urgent/i,
  /flood.*doctor/i,
  /restoration.*doctor/i,
]

/**
 * Run a shell command safely
 */
function run(cmd, timeoutMs = 20000) {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: timeoutMs }).trim()
  } catch {
    return null
  }
}

/**
 * Load state (last check timestamp, seen message IDs)
 */
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
    }
  } catch {}
  return { lastCheck: null, seenIds: [] }
}

/**
 * Save state
 */
function saveState(state) {
  try {
    const dir = config.paths.workspace
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    // Keep only last 200 seen IDs
    state.seenIds = state.seenIds.slice(-200)
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
  } catch (err) {
    console.error('[EmailWatcher] Failed to save state:', err.message)
  }
}

/**
 * Check if sender/subject matches VIP patterns
 */
function isVIP(from, subject) {
  const combined = `${from || ''} ${subject || ''}`
  return VIP_PATTERNS.some(p => p.test(combined))
}

/**
 * Check for new unread emails from VIP senders
 */
function checkForVIPEmails(state) {
  // Search for unread emails from the last hour
  const query = 'is:unread newer_than:1h'
  const raw = run(`${GWS_WORK} gmail users messages list --q "${query}" --maxResults 10`)
  if (!raw) return []

  let messages
  try {
    const parsed = JSON.parse(raw)
    messages = parsed.messages || parsed || []
  } catch {
    return []
  }

  const alerts = []

  for (const msg of messages) {
    const id = msg.id
    if (!id || state.seenIds.includes(id)) continue

    // Get message details
    const detail = run(`${GWS_WORK} gmail users messages get --id "${id}" --format metadata --metadataHeaders "From,Subject"`)
    if (!detail) continue

    let from = ''
    let subject = ''

    try {
      const parsed = JSON.parse(detail)
      const headers = parsed.payload?.headers || []
      from = headers.find(h => h.name === 'From')?.value || ''
      subject = headers.find(h => h.name === 'Subject')?.value || ''
    } catch {
      continue
    }

    state.seenIds.push(id)

    if (isVIP(from, subject)) {
      alerts.push({
        id,
        from: from.replace(/<[^>]+>/, '').trim(),
        subject: subject.substring(0, 100)
      })
    }
  }

  return alerts
}

/**
 * Register email watcher feature
 */
export function register(gateway) {
  const state = loadState()

  const timer = setInterval(() => {
    try {
      const alerts = checkForVIPEmails(state)

      if (alerts.length > 0) {
        state.lastCheck = new Date().toISOString()
        saveState(state)

        const adapter = gateway.adapters.get('whatsapp')
        if (!adapter) return

        // Build alert message
        const lines = [`🔱 *Atlas:* ${alerts.length} important email${alerts.length > 1 ? 's' : ''}:`, '']

        for (const a of alerts) {
          lines.push(`From: ${a.from}`)
          lines.push(`Subject: ${a.subject}`)
          lines.push('')
        }

        lines.push('Reply "read" to have me read the full email.')

        adapter.sendMessage(FRANK_CHAT_ID, lines.join('\n'))
          .then(() => console.log(`[EmailWatcher] Alerted ${alerts.length} VIP email(s)`))
          .catch(err => console.error('[EmailWatcher] Alert failed:', err.message))
      } else {
        // Still save state to track seen IDs
        state.lastCheck = new Date().toISOString()
        saveState(state)
      }
    } catch (err) {
      console.error('[EmailWatcher] Check failed:', err.message)
    }
  }, CHECK_INTERVAL)

  // Do an initial check after 2 minutes (let WhatsApp connect first)
  setTimeout(() => {
    try {
      const alerts = checkForVIPEmails(state)
      if (alerts.length > 0) {
        state.lastCheck = new Date().toISOString()
        saveState(state)

        const adapter = gateway.adapters.get('whatsapp')
        if (adapter) {
          const lines = [`🔱 *Atlas:* ${alerts.length} important email${alerts.length > 1 ? 's' : ''} waiting:`, '']
          for (const a of alerts) {
            lines.push(`From: ${a.from}`)
            lines.push(`Subject: ${a.subject}`)
            lines.push('')
          }
          adapter.sendMessage(FRANK_CHAT_ID, lines.join('\n')).catch(() => {})
        }
      }
    } catch {}
  }, 120000)

  gateway._emailWatcherTimer = timer

  console.log('[EmailWatcher] VIP email alerts enabled (checking every 15 min)')
}
