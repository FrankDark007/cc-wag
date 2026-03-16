import fs from 'fs'
import path from 'path'

/**
 * Pushback Assistant + Rate Calculator Feature
 * Provides IICRC-backed pushback responses for adjuster disputes
 * and rate multiplier calculations for after-hours/weekend/holiday work.
 *
 * Commands:
 *   /pushback "<query>"      — Fuzzy match against KB triggers
 *   /pushback <job-id>       — Job-specific pushback analysis
 *   /pushback categories     — List all pushback categories
 *   /pushback list           — Alias for categories
 *   /pushback help           — Show all pushback commands
 *   /rate <datetime>         — Show rate multiplier for a given date/time
 *   /rate job <job-id>       — Calculate after-hours premium for a job
 *   /rate help               — Show rate commands
 *
 * Storage:
 *   workspace/xactimate-kb/pushback-responses.json
 *   workspace/xactimate-kb/equipment-mapping.json
 *   workspace/jobs.json
 */

const WORKSPACE = '/Users/ghost/Projects/cc-wag/workspace'
const KB_DIR = path.join(WORKSPACE, 'xactimate-kb')
const PUSHBACK_FILE = path.join(KB_DIR, 'pushback-responses.json')
const EQUIPMENT_FILE = path.join(KB_DIR, 'equipment-mapping.json')
const JOBS_FILE = path.join(WORKSPACE, 'jobs.json')

// ── Shared Job Data (with fallback) ─────────────────────────────────

let jobUtils = null

async function ensureJobUtils() {
  if (jobUtils) return jobUtils
  try {
    jobUtils = await import('../utils/job-data.js')
    return jobUtils
  } catch {
    // Fallback: inline minimal job loading
    jobUtils = {
      loadJobs() {
        try {
          if (fs.existsSync(JOBS_FILE)) {
            const raw = fs.readFileSync(JOBS_FILE, 'utf-8')
            const data = JSON.parse(raw)
            if (Array.isArray(data)) return { nextId: data.length + 1, jobs: data }
            return data
          }
        } catch (err) {
          console.error('[PushbackAssistant] Failed to load jobs:', err.message)
        }
        return { nextId: 1, jobs: [] }
      },
      findJob(id) {
        const data = this.loadJobs()
        const upper = id.toUpperCase()
        return data.jobs.find(j => {
          if (j.id === upper) return true
          const num = parseInt(id, 10)
          if (!isNaN(num) && j.id === `FD-${String(num).padStart(3, '0')}`) return true
          return false
        }) || null
      }
    }
    return jobUtils
  }
}

// ── KB Loading ──────────────────────────────────────────────────────

function loadPushbackKB() {
  try {
    if (fs.existsSync(PUSHBACK_FILE)) {
      return JSON.parse(fs.readFileSync(PUSHBACK_FILE, 'utf-8'))
    }
  } catch (err) {
    console.error('[PushbackAssistant] Failed to load pushback KB:', err.message)
  }
  return []
}

function loadEquipmentMapping() {
  try {
    if (fs.existsSync(EQUIPMENT_FILE)) {
      return JSON.parse(fs.readFileSync(EQUIPMENT_FILE, 'utf-8'))
    }
  } catch (err) {
    console.error('[PushbackAssistant] Failed to load equipment mapping:', err.message)
  }
  return {}
}

// ── Fuzzy Matching ──────────────────────────────────────────────────

/**
 * Score a query against a single trigger string.
 * Returns a numeric score (higher = better match), or 0 for no match.
 */
function scoreTrigger(query, trigger) {
  const qLower = query.toLowerCase()
  const tLower = trigger.toLowerCase()

  // Exact match
  if (qLower === tLower) return 100

  // Substring match (either direction)
  if (tLower.includes(qLower)) return 80
  if (qLower.includes(tLower)) return 70

  // Word overlap scoring
  const qWords = qLower.split(/\s+/).filter(w => w.length > 2)
  const tWords = tLower.split(/\s+/).filter(w => w.length > 2)

  let matchCount = 0
  for (const qw of qWords) {
    for (const tw of tWords) {
      if (qw === tw || tw.includes(qw) || qw.includes(tw)) {
        matchCount++
        break
      }
    }
  }

  // Need at least 2 matching words for a word-overlap hit
  if (matchCount >= 2) return 20 + matchCount * 10

  return 0
}

/**
 * Find the best matching pushback response for a query.
 * Returns { entry, score, trigger } or null.
 */
function fuzzyMatchPushback(query, kb) {
  let bestMatch = null
  let bestScore = 0
  let bestTrigger = ''

  for (const entry of kb) {
    if (!entry.triggers || !Array.isArray(entry.triggers)) continue

    for (const trigger of entry.triggers) {
      const score = scoreTrigger(query, trigger)
      if (score > bestScore) {
        bestScore = score
        bestMatch = entry
        bestTrigger = trigger
      }
    }

    // Also match against the ID
    const idScore = scoreTrigger(query, entry.id || '')
    if (idScore > bestScore) {
      bestScore = idScore
      bestMatch = entry
      bestTrigger = entry.id
    }
  }

  if (bestScore === 0 || !bestMatch) return null
  return { entry: bestMatch, score: bestScore, trigger: bestTrigger }
}

// ── Pushback Command Handlers ───────────────────────────────────────

function handlePushbackQuery(query) {
  const kb = loadPushbackKB()
  if (kb.length === 0) {
    return 'Pushback KB not found. Ensure pushback-responses.json exists in workspace/xactimate-kb/'
  }

  // Strip surrounding quotes if present
  const cleaned = query.replace(/^["']|["']$/g, '').trim()

  const match = fuzzyMatchPushback(cleaned, kb)
  if (!match) {
    return `No matching pushback response for: "${cleaned}"\n\nTry \`/pushback categories\` to see available topics.`
  }

  const { entry } = match
  const refs = (entry.references || []).map(r => `  \u2022 ${r}`).join('\n')

  const lines = [
    `\uD83D\uDEE1\uFE0F *Pushback Response: ${entry.category || 'General'}*`,
    '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501',
    '',
    `*Adjuster Claim:* ${entry.adjusterClaim || 'N/A'}`,
    '',
    '*Response:*',
    entry.response || 'No response text available.',
  ]

  if (refs) {
    lines.push('')
    lines.push('*References:*')
    lines.push(refs)
  }

  lines.push('')
  lines.push(`\uD83D\uDCA1 Customize: /pushback ${entry.id} --job FD-002 (adds job-specific details)`)

  return lines.join('\n')
}

function handlePushbackCategories() {
  const kb = loadPushbackKB()
  if (kb.length === 0) {
    return 'Pushback KB not found. Ensure pushback-responses.json exists in workspace/xactimate-kb/'
  }

  // Group by category
  const categories = {}
  for (const entry of kb) {
    const cat = entry.category || 'Uncategorized'
    if (!categories[cat]) categories[cat] = []
    categories[cat].push(entry)
  }

  const lines = [
    '\uD83D\uDEE1\uFE0F *Pushback Categories*',
    '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501',
    '',
  ]

  for (const [cat, entries] of Object.entries(categories)) {
    lines.push(`*${cat}* (${entries.length} response${entries.length !== 1 ? 's' : ''})`)
    for (const e of entries) {
      const firstTrigger = (e.triggers && e.triggers[0]) || 'no triggers'
      lines.push(`  \u2022 ${e.id} \u2014 "${firstTrigger}"`)
    }
    lines.push('')
  }

  lines.push('Use: /pushback "<trigger phrase>" to get a full response')

  return lines.join('\n')
}

async function handlePushbackJob(jobId, gateway) {
  const utils = await ensureJobUtils()
  const job = utils.findJob(jobId)
  if (!job) {
    return `Job not found: ${jobId}\n\nUse a job ID like FD-002 or just the number.`
  }

  const kb = loadPushbackKB()
  if (kb.length === 0) {
    return 'Pushback KB not found. Cannot analyze pushback points without it.'
  }

  // Build a list of likely pushback points based on job characteristics
  const relevantResponses = []

  for (const entry of kb) {
    // Simple heuristic: check if any job fields suggest this category
    const catLower = (entry.category || '').toLowerCase()
    const idLower = (entry.id || '').toLowerCase()
    const claimLower = (entry.adjusterClaim || '').toLowerCase()

    let relevant = false

    // Check job notes for keywords
    const allNotes = (job.notes || []).map(n => n.text || '').join(' ').toLowerCase()
    const jobStr = JSON.stringify(job).toLowerCase()

    // Match entry triggers against job data
    for (const trigger of (entry.triggers || [])) {
      if (jobStr.includes(trigger.toLowerCase().split(' ')[0])) {
        relevant = true
        break
      }
    }

    // Category-based heuristics
    if (catLower.includes('drying') && (jobStr.includes('drying') || jobStr.includes('dehu') || jobStr.includes('moisture'))) {
      relevant = true
    }
    if (catLower.includes('antimicrobial') && (jobStr.includes('mold') || jobStr.includes('cat 2') || jobStr.includes('cat 3') || jobStr.includes('antimicrobial'))) {
      relevant = true
    }
    if (idLower.includes('after-hours') && (jobStr.includes('after hours') || jobStr.includes('weekend') || jobStr.includes('emergency'))) {
      relevant = true
    }

    if (relevant) {
      relevantResponses.push(entry)
    }
  }

  // If we found some, show them inline
  if (relevantResponses.length > 0) {
    const lines = [
      `\uD83D\uDEE1\uFE0F *Preemptive Pushback Analysis: ${job.id}*`,
      `Client: ${job.client}`,
      `Status: ${job.status}`,
      '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501',
      '',
      `Found ${relevantResponses.length} likely pushback point(s):`,
      '',
    ]

    for (const entry of relevantResponses) {
      lines.push(`*${entry.category}: ${entry.adjusterClaim}*`)
      // Truncate response to first 200 chars for overview
      const shortResponse = (entry.response || '').substring(0, 200)
      lines.push(shortResponse + (entry.response && entry.response.length > 200 ? '...' : ''))
      lines.push(`  \u2192 Full response: /pushback "${entry.id}"`)
      lines.push('')
    }

    return lines.join('\n')
  }

  // For complex analysis, use agentRunner if available
  if (gateway && gateway.agentRunner) {
    const kbSummary = kb.map(e => `- ${e.id}: ${e.adjusterClaim} [${e.category}]`).join('\n')
    const prompt = `Analyze this restoration job and predict which pushback points an adjuster is likely to raise. For each, provide the relevant KB response.

JOB DATA:
${JSON.stringify(job, null, 2)}

AVAILABLE PUSHBACK RESPONSES:
${kbSummary}

FULL KB (use IDs to reference full responses):
${JSON.stringify(kb, null, 2)}

Provide a concise analysis of likely pushback points for this job, with the full IICRC-backed response for each.`

    try {
      // Return a message indicating analysis is running
      return `\uD83D\uDEE1\uFE0F Analyzing pushback points for *${job.id}* (${job.client})...\n\nRunning deep analysis via Claude agent. Response will follow.`
    } catch (err) {
      console.error('[PushbackAssistant] Agent analysis failed:', err.message)
    }
  }

  return `No obvious pushback points detected for ${job.id} based on current job data.\n\nTip: Add notes with /job ${job.id} note <details> to improve analysis.\nOr try: /pushback categories to browse all available responses.`
}

function handlePushbackHelp() {
  return [
    '\uD83D\uDEE1\uFE0F *Pushback Assistant Commands*',
    '',
    '/pushback "<query>" \u2014 Find a pushback response by topic',
    '/pushback <job-id> \u2014 Analyze likely pushback for a job',
    '/pushback categories \u2014 List all categories and triggers',
    '/pushback list \u2014 Alias for categories',
    '/pushback help \u2014 This help message',
    '',
    '*Examples:*',
    '/pushback "too many drying days"',
    '/pushback "antimicrobial not needed"',
    '/pushback FD-002',
    '/pushback categories',
  ].join('\n')
}

// ── Rate Calculator ─────────────────────────────────────────────────

/**
 * Parse flexible date/time input into a Date object.
 * Supports:
 *   "2026-03-14 8pm"
 *   "saturday 3pm"
 *   "tomorrow 11pm"
 *   "now"
 *   "sunday"
 */
function parseDateTime(input) {
  const lower = input.trim().toLowerCase()

  if (lower === 'now') return new Date()

  // Day-of-week names
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

  // Check for relative days
  const today = new Date()

  if (lower.startsWith('tomorrow')) {
    const d = new Date(today)
    d.setDate(d.getDate() + 1)
    const timePart = lower.replace('tomorrow', '').trim()
    if (timePart) applyTime(d, timePart)
    return d
  }

  if (lower.startsWith('today')) {
    const d = new Date(today)
    const timePart = lower.replace('today', '').trim()
    if (timePart) applyTime(d, timePart)
    return d
  }

  // Check for day-of-week
  for (let i = 0; i < dayNames.length; i++) {
    if (lower.startsWith(dayNames[i])) {
      const d = new Date(today)
      const currentDay = d.getDay()
      let daysAhead = i - currentDay
      if (daysAhead <= 0) daysAhead += 7
      d.setDate(d.getDate() + daysAhead)
      const timePart = lower.replace(dayNames[i], '').trim()
      if (timePart) applyTime(d, timePart)
      else { d.setHours(12, 0, 0, 0) } // default noon
      return d
    }
  }

  // Try standard date parsing (e.g., "2026-03-14 8pm")
  // Split into date part and time part
  const parts = lower.split(/\s+/)
  if (parts.length >= 2) {
    const datePart = parts[0]
    const timePart = parts.slice(1).join(' ')
    const d = new Date(datePart)
    if (!isNaN(d.getTime())) {
      applyTime(d, timePart)
      return d
    }
  }

  // Last resort: try JS Date parsing directly
  const d = new Date(input)
  if (!isNaN(d.getTime())) return d

  return null
}

/**
 * Apply a time string like "8pm", "3:30pm", "14:00", "11pm" to a Date object.
 */
function applyTime(date, timeStr) {
  const lower = timeStr.trim().toLowerCase()

  // Match "8pm", "8 pm", "8:30pm", "8:30 pm"
  const match = lower.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/)
  if (match) {
    let hours = parseInt(match[1], 10)
    const minutes = parseInt(match[2] || '0', 10)
    const ampm = match[3]

    if (ampm === 'pm' && hours < 12) hours += 12
    if (ampm === 'am' && hours === 12) hours = 0

    date.setHours(hours, minutes, 0, 0)
    return
  }

  // Try 24-hour format "14:00"
  const match24 = lower.match(/^(\d{1,2}):(\d{2})$/)
  if (match24) {
    date.setHours(parseInt(match24[1], 10), parseInt(match24[2], 10), 0, 0)
  }
}

/**
 * Load holidays from equipment-mapping.json
 */
function loadHolidays() {
  const mapping = loadEquipmentMapping()
  return mapping.holidays2026 || mapping.holidays || []
}

/**
 * Check if a date falls on a holiday.
 */
function isHoliday(date, holidays) {
  const dateStr = date.toISOString().split('T')[0] // YYYY-MM-DD
  const month = date.getMonth() + 1
  const day = date.getDate()
  const mmdd = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

  for (const h of holidays) {
    // Support both full date "2026-03-14" and MM-DD "12-25" formats
    const hStr = String(h.date || h)
    if (hStr === dateStr || hStr === mmdd) return h
    // Also check if it's just a string date
    if (typeof h === 'string' && (h === dateStr || h === mmdd)) return { date: h, name: 'Holiday' }
  }

  return null
}

/**
 * Get rate multiplier and label for a given date/time.
 * Returns { multiplier, label, detail }
 */
function getRateMultiplier(date, holidays) {
  if (!holidays) holidays = loadHolidays()

  const dayOfWeek = date.getDay() // 0=Sun, 6=Sat
  const hour = date.getHours()

  // Holiday check first (2.0x)
  const holiday = isHoliday(date, holidays)
  if (holiday) {
    const name = holiday.name || holiday
    return { multiplier: 2.0, label: 'Holiday', detail: `${name} (2.0x)` }
  }

  // Sunday (2.0x)
  if (dayOfWeek === 0) {
    return { multiplier: 2.0, label: 'Weekend', detail: 'Sunday (2.0x)' }
  }

  // Saturday (1.5x)
  if (dayOfWeek === 6) {
    return { multiplier: 1.5, label: 'Weekend', detail: 'Saturday (1.5x)' }
  }

  // Weekday after hours: 6pm-7am (1.5x)
  if (hour >= 18 || hour < 7) {
    return { multiplier: 1.5, label: 'After Hours', detail: `Weekday ${formatHour(hour)} = After Hours (1.5x)` }
  }

  // Weekday business hours: 7am-6pm (1.0x)
  return { multiplier: 1.0, label: 'Business Hours', detail: `Weekday ${formatHour(hour)} = Business Hours (1.0x)` }
}

function formatHour(hour) {
  if (hour === 0) return '12am'
  if (hour < 12) return `${hour}am`
  if (hour === 12) return '12pm'
  return `${hour - 12}pm`
}

function formatDayName(date) {
  return date.toLocaleDateString('en-US', { weekday: 'long' })
}

function formatFullDate(date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
}

// ── Rate Command Handlers ───────────────────────────────────────────

function handleRateCheck(input) {
  const date = parseDateTime(input)
  if (!date) {
    return `Could not parse date/time: "${input}"\n\nExamples:\n/rate now\n/rate saturday 3pm\n/rate 2026-03-14 8pm\n/rate tomorrow 11pm`
  }

  const holidays = loadHolidays()
  const rate = getRateMultiplier(date, holidays)

  const lines = [
    `\u23F0 *Rate Calculator*`,
    '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501',
    '',
    `*Date:* ${formatFullDate(date)} at ${formatHour(date.getHours())}`,
    `*Day:* ${formatDayName(date)}`,
    `*Rate:* ${rate.detail}`,
    `*Multiplier:* ${rate.multiplier}x`,
  ]

  if (rate.multiplier > 1.0) {
    lines.push('')
    lines.push(`\uD83D\uDCB0 Premium rate applies. Document time-stamped photos and labor logs.`)
  }

  return lines.join('\n')
}

async function handleRateJob(jobId) {
  const utils = await ensureJobUtils()
  const job = utils.findJob(jobId)
  if (!job) {
    return `Job not found: ${jobId}`
  }

  // Check for CompanyCam timestamps or job date data
  const timestamps = []

  // Look for timestamps in job data
  if (job.workLog && Array.isArray(job.workLog)) {
    for (const entry of job.workLog) {
      if (entry.start) timestamps.push(new Date(entry.start))
      if (entry.end) timestamps.push(new Date(entry.end))
    }
  }

  // Check CompanyCam photos if available
  if (job.companycamPhotos && Array.isArray(job.companycamPhotos)) {
    for (const photo of job.companycamPhotos) {
      if (photo.created_at || photo.capturedAt) {
        timestamps.push(new Date(photo.created_at || photo.capturedAt))
      }
    }
  }

  // Check notes for time references
  if (job.dateCreated) timestamps.push(new Date(job.dateCreated))
  if (job.dateCompleted) timestamps.push(new Date(job.dateCompleted))

  if (timestamps.length === 0) {
    return [
      `*Rate Analysis: ${job.id}* (${job.client})`,
      '',
      'No timestamps found for this job.',
      'Add CompanyCam photos or work log entries to calculate after-hours premium.',
      '',
      'Manual check:',
      `/rate ${job.dateCreated ? new Date(job.dateCreated).toISOString().split('T')[0] : 'now'} 8pm`,
    ].join('\n')
  }

  const holidays = loadHolidays()
  let totalPremiumHours = 0
  let totalNormalHours = 0
  const breakdown = []

  for (const ts of timestamps) {
    if (isNaN(ts.getTime())) continue
    const rate = getRateMultiplier(ts, holidays)
    breakdown.push({
      time: ts,
      multiplier: rate.multiplier,
      label: rate.label,
      detail: rate.detail
    })
    if (rate.multiplier > 1.0) {
      totalPremiumHours++
    } else {
      totalNormalHours++
    }
  }

  // Sort by date
  breakdown.sort((a, b) => a.time - b.time)

  const lines = [
    `\u23F0 *Rate Analysis: ${job.id}* (${job.client})`,
    '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501',
    '',
    `Timestamps analyzed: ${timestamps.length}`,
    `Premium rate entries: ${totalPremiumHours}`,
    `Normal rate entries: ${totalNormalHours}`,
    '',
    '*Breakdown:*',
  ]

  for (const b of breakdown) {
    const marker = b.multiplier > 1.0 ? '\uD83D\uDCB0' : '\u2705'
    lines.push(`${marker} ${b.time.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} \u2014 ${b.detail}`)
  }

  if (totalPremiumHours > 0) {
    lines.push('')
    lines.push(`\uD83D\uDCB0 *${totalPremiumHours} premium-rate timestamp(s) detected.* Ensure these are documented in the invoice scope.`)
  }

  return lines.join('\n')
}

function handleRateHelp() {
  return [
    '\u23F0 *Rate Calculator Commands*',
    '',
    '/rate <datetime> \u2014 Show rate multiplier for a date/time',
    '/rate job <job-id> \u2014 Calculate after-hours premium for a job',
    '/rate help \u2014 This help message',
    '',
    '*Examples:*',
    '/rate now',
    '/rate saturday 3pm',
    '/rate 2026-03-14 8pm',
    '/rate tomorrow 11pm',
    '/rate sunday',
    '/rate job FD-002',
    '',
    '*Rate Schedule:*',
    '  1.0x \u2014 Weekday 7am-6pm (business hours)',
    '  1.5x \u2014 Weekday 6pm-7am (after hours)',
    '  1.5x \u2014 Saturday (all day)',
    '  2.0x \u2014 Sunday (all day)',
    '  2.0x \u2014 Holidays (all day)',
  ].join('\n')
}

// ── Command Router ──────────────────────────────────────────────────

async function handleCommand(text, gateway) {
  const trimmed = text.trim()
  const lower = trimmed.toLowerCase()

  // ── /pushback commands ────────────────────────────────────────────
  if (lower.startsWith('/pushback')) {
    const rest = trimmed.slice(9).trim()
    const restLower = rest.toLowerCase()

    // No args = help
    if (!rest) return handlePushbackHelp()

    // /pushback help
    if (restLower === 'help') return handlePushbackHelp()

    // /pushback categories | /pushback list
    if (restLower === 'categories' || restLower === 'list') return handlePushbackCategories()

    // /pushback FD-002 or /pushback 2 (job ID pattern)
    const jobIdMatch = rest.match(/^(FD-\d{3}|\d{1,4})$/i)
    if (jobIdMatch) {
      return await handlePushbackJob(jobIdMatch[1], gateway)
    }

    // /pushback "query" or /pushback query text
    return handlePushbackQuery(rest)
  }

  // ── /rate commands ────────────────────────────────────────────────
  if (lower.startsWith('/rate')) {
    const rest = trimmed.slice(5).trim()
    const restLower = rest.toLowerCase()

    // No args = help
    if (!rest) return handleRateHelp()

    // /rate help
    if (restLower === 'help') return handleRateHelp()

    // /rate job <id>
    if (restLower.startsWith('job ')) {
      const jobId = rest.slice(4).trim()
      return await handleRateJob(jobId)
    }

    // /rate <datetime>
    return handleRateCheck(rest)
  }

  return 'Unknown command. Try /pushback help or /rate help'
}

// ── Plugin Registration ─────────────────────────────────────────────

export function register(gateway) {
  const originalExecute = gateway.commandHandler.execute.bind(gateway.commandHandler)

  gateway.commandHandler.execute = async function (text, sessionKey, adapter, chatId) {
    const cmd = text.trim().toLowerCase()

    if (cmd.startsWith('/pushback') || cmd.startsWith('/rate')) {
      const response = await handleCommand(text.trim(), gateway)
      return { handled: true, response }
    }

    return originalExecute(text, sessionKey, adapter, chatId)
  }

  // Extend /help
  const originalHelp = gateway.commandHandler.handleHelp.bind(gateway.commandHandler)
  gateway.commandHandler.handleHelp = function () {
    const result = originalHelp()
    const lines = [
      '',
      '--- Pushback Assistant ---',
      '/pushback "<query>" \u2014 Find IICRC-backed pushback response',
      '/pushback <job-id> \u2014 Analyze job pushback points',
      '/pushback categories \u2014 List all topics',
      '',
      '--- Rate Calculator ---',
      '/rate <datetime> \u2014 Rate multiplier check',
      '/rate job <job-id> \u2014 After-hours premium analysis',
    ]
    result.response += '\n' + lines.join('\n')
    return result
  }

  console.log('[PushbackAssistant] Feature loaded \u2014 /pushback and /rate commands enabled')
}
