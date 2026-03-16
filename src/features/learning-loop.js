import fs from 'fs'
import path from 'path'

/**
 * Learning Loop Feature
 * Atlas learns from Frank's corrections and improves over time.
 *
 * Passive detection:
 *   Monitors all messages for correction signals ("no, that's wrong",
 *   "actually...", "always...", "never...", etc.) and logs them as
 *   observations + preferences.
 *
 * Commands:
 *   /atlas learn         - Show all learned preferences
 *   /atlas preferences   - Same as /atlas learn
 *   /atlas forget <topic> - Remove preference by keyword match
 *   /atlas forget all    - Clear all preferences
 *
 * API (gateway._learningLoop):
 *   getPreferencesContext() - Returns string for system prompt injection
 *
 * Storage:
 *   workspace/learned-preferences.json
 *   workspace/memory/observations.jsonl (append)
 */

import config from '../config.js'

const WORKSPACE = config.paths.workspace
const PREFS_FILE = path.join(WORKSPACE, 'learned-preferences.json')
const OBS_FILE = path.join(WORKSPACE, 'memory', 'observations.jsonl')

const CORRECTION_PATTERNS = [
  /^no[,.]?\s/i,
  /^actually[,.]?\s/i,
  /^don'?t\s/i,
  /^always\s/i,
  /^never\s/i,
  /^i meant/i,
  /^that'?s wrong/i,
  /^incorrect/i,
  /^not like that/i,
  /^i prefer/i,
  /^i want/i,
  /^stop doing/i,
  /^from now on/i,
  /^remember that/i,
  /^note:/i,
]

// ── Storage ──────────────────────────────────────────────────────────

function loadPreferences() {
  try {
    if (fs.existsSync(PREFS_FILE)) {
      return JSON.parse(fs.readFileSync(PREFS_FILE, 'utf-8'))
    }
  } catch (err) {
    console.error('[LearningLoop] Failed to load preferences:', err.message)
  }
  return { preferences: [], stats: { totalCorrections: 0, totalPreferences: 0, lastWeeklyReview: null } }
}

function savePreferences(data) {
  const dir = path.dirname(PREFS_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(PREFS_FILE, JSON.stringify(data, null, 2))
}

function appendObservation(content, source) {
  try {
    const dir = path.dirname(OBS_FILE)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const entry = {
      type: 'observation',
      content,
      timestamp: new Date().toISOString(),
      source: source || 'correction'
    }
    fs.appendFileSync(OBS_FILE, JSON.stringify(entry) + '\n')
  } catch (err) {
    console.error('[LearningLoop] Failed to append observation:', err.message)
  }
}

// ── Correction Detection (passive) ───────────────────────────────────

function isCorrection(text) {
  const trimmed = text.trim()
  return CORRECTION_PATTERNS.some(pattern => pattern.test(trimmed))
}

function detectAndLearn(text) {
  if (!isCorrection(text)) return

  const trimmed = text.trim()
  const data = loadPreferences()

  // Check if this reinforces an existing preference
  const existing = data.preferences.find(p =>
    p.active && trimmed.toLowerCase().includes(p.content.toLowerCase().split(' ').slice(0, 3).join(' '))
  )

  if (existing) {
    existing.timesReinforced = (existing.timesReinforced || 1) + 1
    existing.lastReinforced = new Date().toISOString()
    data.stats.totalCorrections++
    savePreferences(data)
    appendObservation(`Reinforced preference: ${existing.content}`, 'reinforcement')
    console.log(`[LearningLoop] Reinforced preference: ${existing.content} (${existing.timesReinforced}x)`)
    return
  }

  // New preference
  const nextId = data.preferences.length + 1
  const preference = {
    id: `pref-${nextId}`,
    content: trimmed,
    source: 'correction',
    learnedAt: new Date().toISOString(),
    triggerMessage: trimmed,
    timesReinforced: 1,
    active: true
  }

  data.preferences.push(preference)
  data.stats.totalCorrections++
  data.stats.totalPreferences++
  savePreferences(data)
  appendObservation(`New preference learned: ${trimmed}`, 'correction')
  console.log(`[LearningLoop] New preference learned: ${trimmed}`)
}

// ── Command Handlers ─────────────────────────────────────────────────

function handleLearn() {
  const data = loadPreferences()
  const active = data.preferences.filter(p => p.active)

  if (!active.length) {
    return [
      '\uD83E\uDDE0 *What I\'ve Learned*',
      '\u2501'.repeat(19),
      '',
      'No preferences learned yet.',
      '',
      'I learn from corrections like:',
      '- "Always include IICRC references"',
      '- "Don\'t use that format"',
      '- "From now on, keep it shorter"'
    ].join('\n')
  }

  const lines = [
    '\uD83E\uDDE0 *What I\'ve Learned*',
    '\u2501'.repeat(19),
    '',
    `${active.length} preferences from ${data.stats.totalCorrections} corrections:`,
    ''
  ]

  for (let i = 0; i < active.length; i++) {
    const p = active[i]
    const reinforced = p.timesReinforced > 1 ? ` (reinforced ${p.timesReinforced}x)` : ''
    lines.push(`${i + 1}. ${p.content}${reinforced}`)
  }

  if (data.stats.totalCorrections > 0 && active.length > 0) {
    const rate = Math.round((active.length / data.stats.totalCorrections) * 100)
    lines.push('')
    lines.push(`Stats: ${rate}% of corrections became preferences`)
  }

  return lines.join('\n')
}

function handleForget(topic) {
  if (!topic) {
    return 'Usage: /atlas forget <keyword> or /atlas forget all'
  }

  const data = loadPreferences()

  if (topic.toLowerCase() === 'all') {
    const count = data.preferences.filter(p => p.active).length
    data.preferences.forEach(p => { p.active = false })
    savePreferences(data)
    appendObservation('All preferences cleared by user', 'manual')
    return `Cleared ${count} preferences. Starting fresh.`
  }

  const lower = topic.toLowerCase()
  const matches = data.preferences.filter(p =>
    p.active && p.content.toLowerCase().includes(lower)
  )

  if (!matches.length) {
    return `No active preferences matching "${topic}"`
  }

  matches.forEach(p => { p.active = false })
  savePreferences(data)
  appendObservation(`Forgot preferences matching: ${topic}`, 'manual')

  if (matches.length === 1) {
    return `Forgot: "${matches[0].content}"`
  }
  return `Forgot ${matches.length} preferences matching "${topic}":\n${matches.map(p => `- ${p.content}`).join('\n')}`
}

// ── Router ───────────────────────────────────────────────────────────

function handleAtlasLearn(text) {
  const lower = text.toLowerCase()

  if (lower === '/atlas learn' || lower === '/atlas preferences') {
    return handleLearn()
  }

  if (lower.startsWith('/atlas forget')) {
    const topic = text.slice('/atlas forget'.length).trim()
    return handleForget(topic)
  }

  return null
}

// ── Register ─────────────────────────────────────────────────────────

export function register(gateway) {
  const originalExecute = gateway.commandHandler.execute.bind(gateway.commandHandler)

  gateway.commandHandler.execute = async function (text, sessionKey, adapter, chatId) {
    // Passive learning — observe all messages, don't block
    try {
      detectAndLearn(text)
    } catch (err) {
      console.error('[LearningLoop] Passive detection error:', err.message)
    }

    // Handle explicit /atlas learn|preferences|forget commands
    const lower = text.trim().toLowerCase()
    if (lower.startsWith('/atlas learn') || lower.startsWith('/atlas preferences') || lower.startsWith('/atlas forget')) {
      const response = handleAtlasLearn(text.trim())
      if (response) return { handled: true, response }
    }

    return originalExecute(text, sessionKey, adapter, chatId)
  }

  // Expose API for system prompt injection
  gateway._learningLoop = {
    getPreferencesContext() {
      const prefs = loadPreferences()
      const active = prefs.preferences.filter(p => p.active)
      if (!active.length) return ''
      return '\n\nLearned preferences (from Frank\'s corrections):\n' +
        active.map(p => `- ${p.content}`).join('\n')
    },
    getPreferences() {
      return loadPreferences()
    }
  }

  console.log('[LearningLoop] Feature loaded — passive correction detection + /atlas learn|forget')
}
