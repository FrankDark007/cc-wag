import { execSync } from 'child_process'

/**
 * Calendar Alerts Feature
 * Sends 30-minute pre-event WhatsApp reminders
 *
 * Checks calendar every 5 minutes.
 * Deduplicates: only one alert per event.
 */

import config from '../config.js'

const GWS = config.paths.gwsBin
const FRANK_CHAT_ID = '17034981581@s.whatsapp.net'
const CHECK_INTERVAL = 5 * 60 * 1000 // 5 minutes
const ALERT_WINDOW = 30 * 60 * 1000  // 30 minutes before event

/**
 * Run a shell command safely
 */
function run(cmd, timeoutMs = 15000) {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: timeoutMs }).trim()
  } catch {
    return null
  }
}

/**
 * Parse calendar events from gws output
 * Returns array of { summary, start, end, location }
 */
function getUpcomingEvents() {
  // Get today's events in JSON format
  const raw = run(`${GWS} calendar events list --calendarId primary --timeMin "${new Date().toISOString()}" --timeMax "${endOfDay()}" --singleEvents true --orderBy startTime --maxResults 10`)
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw)
    const items = parsed.items || parsed || []
    return items.map(e => ({
      id: e.id || e.summary || '',
      summary: e.summary || 'Untitled Event',
      start: e.start?.dateTime || e.start?.date || null,
      end: e.end?.dateTime || e.end?.date || null,
      location: e.location || null
    })).filter(e => e.start)
  } catch {
    // Fallback: try parsing the agenda format
    return parseAgendaFormat(raw)
  }
}

/**
 * Fallback parser for gws calendar +agenda format
 */
function parseAgendaFormat(raw) {
  // The +agenda format varies, try to extract event info
  const events = []
  const lines = raw.split('\n')

  for (const line of lines) {
    // Try to match time patterns like "10:00 AM - 11:00 AM  Meeting name"
    const match = line.match(/(\d{1,2}:\d{2}\s*(?:AM|PM)?)\s*[-–]\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)\s+(.+)/i)
    if (match) {
      const today = new Date().toISOString().split('T')[0]
      events.push({
        id: match[3].trim(),
        summary: match[3].trim(),
        start: `${today}T${to24h(match[1])}:00`,
        end: `${today}T${to24h(match[2])}:00`,
        location: null
      })
    }
  }

  return events
}

/**
 * Convert 12h time to 24h (rough)
 */
function to24h(timeStr) {
  const clean = timeStr.trim().toUpperCase()
  const match = clean.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/)
  if (!match) return '00:00'

  let h = parseInt(match[1])
  const m = match[2]
  const ampm = match[3]

  if (ampm === 'PM' && h < 12) h += 12
  if (ampm === 'AM' && h === 12) h = 0

  return `${String(h).padStart(2, '0')}:${m}`
}

function endOfDay() {
  const d = new Date()
  d.setHours(23, 59, 59, 999)
  return d.toISOString()
}

/**
 * Register calendar alerts feature
 */
export function register(gateway) {
  const sentAlerts = new Set() // Track sent alert IDs to prevent duplicates

  const timer = setInterval(() => {
    try {
      const events = getUpcomingEvents()
      const now = Date.now()

      for (const event of events) {
        const eventTime = new Date(event.start).getTime()
        const timeUntil = eventTime - now

        // Alert window: between 25-35 minutes before (accounts for 5-min check interval)
        if (timeUntil > 0 && timeUntil <= ALERT_WINDOW + CHECK_INTERVAL && timeUntil > ALERT_WINDOW - CHECK_INTERVAL) {
          const alertKey = `${event.id}_${event.start}`

          if (sentAlerts.has(alertKey)) continue
          sentAlerts.add(alertKey)

          const mins = Math.round(timeUntil / 60000)
          const timeStr = new Date(event.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

          let msg = `🔱 *Atlas:* ${event.summary} starts in ${mins} min (${timeStr})`
          if (event.location) msg += `\nLocation: ${event.location}`

          const adapter = gateway.adapters.get('whatsapp')
          if (adapter) {
            adapter.sendMessage(FRANK_CHAT_ID, msg)
              .then(() => console.log(`[CalendarAlerts] Sent alert: ${event.summary}`))
              .catch(err => console.error(`[CalendarAlerts] Failed:`, err.message))
          }
        }
      }

      // Clean old alert keys (older than 2 hours)
      if (sentAlerts.size > 50) {
        sentAlerts.clear()
      }
    } catch (err) {
      console.error('[CalendarAlerts] Check failed:', err.message)
    }
  }, CHECK_INTERVAL)

  gateway._calendarAlertsTimer = timer

  console.log('[CalendarAlerts] 30-min pre-event alerts enabled (checking every 5 min)')
}
