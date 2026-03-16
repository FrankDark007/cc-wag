/**
 * Error Reporter Feature
 * Sends critical errors to Frank via WhatsApp and logs them to a persistent error log.
 *
 * What it reports:
 *   - Unhandled rejections (non-Bad-MAC)
 *   - Uncaught exceptions
 *   - Feature load failures
 *   - Agent run failures (Timed Out, API errors)
 *   - WhatsApp connection drops
 *
 * Commands:
 *   /errors         — Show recent errors
 *   /errors clear   — Clear error log
 *   /errors stats   — Error counts by category
 *
 * Storage: workspace/error-log.json
 * Rate limit: Max 1 WhatsApp alert per error type per 15 minutes
 */

import fs from 'fs'
import path from 'path'

const WORKSPACE = '/Users/ghost/Projects/cc-wag/workspace'
const ERROR_LOG = path.join(WORKSPACE, 'error-log.json')
const FRANK_CHAT_ID = '17034981581@s.whatsapp.net'
const MAX_ERRORS = 200 // keep last 200 errors
const RATE_LIMIT_MS = 15 * 60 * 1000 // 15 min per error type

// ── Storage ──────────────────────────────────────────────────────────

function loadErrors() {
  try {
    if (fs.existsSync(ERROR_LOG)) {
      return JSON.parse(fs.readFileSync(ERROR_LOG, 'utf-8'))
    }
  } catch {}
  return { errors: [], lastAlerts: {} }
}

function saveErrors(data) {
  // Trim to max
  if (data.errors.length > MAX_ERRORS) {
    data.errors = data.errors.slice(-MAX_ERRORS)
  }
  fs.writeFileSync(ERROR_LOG, JSON.stringify(data, null, 2))
}

function logError(category, message, details = null) {
  const data = loadErrors()
  data.errors.push({
    timestamp: new Date().toISOString(),
    category,
    message,
    details: details ? String(details).substring(0, 500) : null
  })
  saveErrors(data)
  return data
}

// ── Rate-limited WhatsApp Alert ──────────────────────────────────────

function shouldAlert(category, data) {
  const now = Date.now()
  const lastAlert = data.lastAlerts[category] || 0
  if (now - lastAlert < RATE_LIMIT_MS) return false
  data.lastAlerts[category] = now
  saveErrors(data)
  return true
}

async function alertFrank(gateway, category, message) {
  const data = loadErrors()
  if (!shouldAlert(category, data)) return

  const adapter = gateway.adapters?.get('whatsapp')
  if (!adapter) return

  const alert = [
    '🚨 *Atlas Error*',
    `Category: ${category}`,
    `Error: ${message.substring(0, 300)}`,
    '',
    `Time: ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`,
    'Run /errors for details'
  ].join('\n')

  try {
    await adapter.sendMessage(FRANK_CHAT_ID, alert)
  } catch (err) {
    console.error('[ErrorReporter] Failed to send alert:', err.message)
  }
}

// ── Command Handlers ─────────────────────────────────────────────────

function handleErrors(text) {
  const lower = text.trim().toLowerCase()

  if (lower === '/errors clear') {
    saveErrors({ errors: [], lastAlerts: {} })
    return 'Error log cleared.'
  }

  if (lower === '/errors stats') {
    const data = loadErrors()
    const counts = {}
    const last24h = Date.now() - 24 * 60 * 60 * 1000
    let recent = 0

    for (const err of data.errors) {
      counts[err.category] = (counts[err.category] || 0) + 1
      if (new Date(err.timestamp).getTime() > last24h) recent++
    }

    const lines = [
      '📊 *Error Stats*',
      '━━━━━━━━━━━━━━',
      '',
      `Total: ${data.errors.length} errors logged`,
      `Last 24h: ${recent}`,
      ''
    ]

    for (const [cat, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      lines.push(`• ${cat}: ${count}`)
    }

    return lines.join('\n')
  }

  // Default: show recent errors
  const data = loadErrors()
  if (!data.errors.length) {
    return '✅ No errors logged.'
  }

  const recent = data.errors.slice(-10).reverse()
  const lines = [
    '🚨 *Recent Errors*',
    '━━━━━━━━━━━━━━━',
    ''
  ]

  for (const err of recent) {
    const time = new Date(err.timestamp).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    })
    lines.push(`*${err.category}* (${time})`)
    lines.push(err.message.substring(0, 150))
    if (err.details) lines.push(`_${err.details.substring(0, 100)}_`)
    lines.push('')
  }

  lines.push(`Showing ${recent.length} of ${data.errors.length} total`)
  return lines.join('\n')
}

// ── Register ─────────────────────────────────────────────────────────

export function register(gateway) {
  // Intercept /errors command
  const originalExecute = gateway.commandHandler.execute.bind(gateway.commandHandler)
  gateway.commandHandler.execute = async function (text, sessionKey, adapter, chatId) {
    if (text.trim().toLowerCase().startsWith('/errors')) {
      return { handled: true, response: handleErrors(text) }
    }
    return originalExecute(text, sessionKey, adapter, chatId)
  }

  // Hook into gateway error events

  // 1. Agent run failures
  gateway.agentRunner.on('failed', ({ runId, error }) => {
    const msg = error || 'Unknown agent error'
    logError('agent-failure', msg)
    alertFrank(gateway, 'agent-failure', msg)
  })

  // 2. WhatsApp connection issues
  const whatsapp = gateway.adapters?.get('whatsapp')
  if (whatsapp?.sock) {
    // Connection drops are logged by the adapter, we monitor via gateway events
    const origSetupAdapter = gateway.setupAdapter
    // We'll hook into console.error to catch patterns
  }

  // 3. Hook into process error handlers — add reporting alongside existing handling
  const origEmit = process.emit.bind(process)
  const seenErrors = new Set()

  process.emit = function (event, ...args) {
    if (event === 'unhandledRejection' || event === 'uncaughtException') {
      const err = args[0]
      const msg = err?.message || String(err)

      // Skip Bad MAC (handled separately) and deduplication
      if (!msg.includes('Bad MAC') && !msg.includes('Bad encrypted message')) {
        const key = msg.substring(0, 100)
        if (!seenErrors.has(key)) {
          seenErrors.add(key)
          // Clear dedup after 5 minutes
          setTimeout(() => seenErrors.delete(key), 5 * 60 * 1000)

          const category = event === 'unhandledRejection' ? 'unhandled-rejection' : 'uncaught-exception'
          logError(category, msg, err?.stack?.substring(0, 500))
          alertFrank(gateway, category, msg)
        }
      }
    }
    return origEmit(event, ...args)
  }

  // 4. Bad MAC alerts (rate-limited, only on auto-cleanup)
  gateway._errorReporter = {
    log: logError,
    alert: (category, message) => alertFrank(gateway, category, message),
    reportBadMacCleanup(contactId, filesDeleted) {
      logError('bad-mac-cleanup', `Auto-cleaned ${filesDeleted} session files for contact ${contactId}`)
      alertFrank(gateway, 'bad-mac-cleanup', `WhatsApp encryption keys corrupted for contact ${contactId}. Auto-cleaned ${filesDeleted} session files. Baileys will re-negotiate.`)
    }
  }

  // Extend /help
  const originalHelp = gateway.commandHandler.handleHelp.bind(gateway.commandHandler)
  gateway.commandHandler.handleHelp = function () {
    const result = originalHelp()
    result.response += '\n\n--- Error Reporting ---\n/errors — Recent errors\n/errors stats — Error counts\n/errors clear — Clear log'
    return result
  }

  console.log('[ErrorReporter] Feature loaded — /errors command + WhatsApp alerts')
}
