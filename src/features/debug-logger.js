import fs from 'fs'

/**
 * Debug Logger Feature
 * Toggle verbose error/event logging via WhatsApp commands.
 *
 * Commands:
 *   /log on   — Enable debug logging (errors sent to WhatsApp + written to file)
 *   /log off  — Disable debug logging (back to normal console-only)
 *   /log      — Show current status + tail of recent log entries
 *
 * When ON:
 *   - All console.error output is captured and forwarded to Frank via WhatsApp
 *   - Feature plugin errors are caught and logged with stack traces
 *   - All log entries written to workspace/debug.log
 *   - Gateway events (message in, tool use, queue status) are logged
 *
 * When OFF:
 *   - Normal behavior, nothing extra
 */

import config from '../config.js'

const LOG_FILE = config.paths.debugLog
const FRANK_CHAT_ID = '17034981581@s.whatsapp.net'
const MAX_LOG_LINES = 500
const MAX_WA_MSG_LEN = 3000

let enabled = false
let gateway = null
let originalConsoleError = null
let originalConsoleWarn = null

/**
 * Write a timestamped entry to the debug log file
 */
function writeLog(level, msg) {
  const ts = new Date().toISOString()
  const entry = `[${ts}] [${level}] ${msg}\n`
  try {
    fs.appendFileSync(LOG_FILE, entry, 'utf-8')
  } catch {}
}

/**
 * Send a debug message to Frank via WhatsApp (truncated if needed)
 */
async function sendToFrank(msg) {
  if (!gateway) return
  const adapter = gateway.adapters.get('whatsapp')
  if (!adapter) return

  const truncated = msg.length > MAX_WA_MSG_LEN
    ? msg.substring(0, MAX_WA_MSG_LEN) + '\n... (truncated, see /log for full)'
    : msg

  try {
    await adapter.sendMessage(FRANK_CHAT_ID, `🔧 *Debug:* ${truncated}`)
  } catch {}
}

/**
 * Intercept console.error and console.warn when debug mode is on
 */
function hookConsole() {
  if (originalConsoleError) return // Already hooked

  originalConsoleError = console.error
  originalConsoleWarn = console.warn

  console.error = (...args) => {
    originalConsoleError.apply(console, args)
    if (enabled) {
      const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a, null, 2)).join(' ')
      writeLog('ERROR', msg)
      sendToFrank(msg)
    }
  }

  console.warn = (...args) => {
    originalConsoleWarn.apply(console, args)
    if (enabled) {
      const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a, null, 2)).join(' ')
      writeLog('WARN', msg)
    }
  }
}

/**
 * Read tail of debug log
 */
function tailLog(lines = 20) {
  try {
    if (!fs.existsSync(LOG_FILE)) return 'No debug log file yet.'
    const content = fs.readFileSync(LOG_FILE, 'utf-8').trim()
    if (!content) return 'Debug log is empty.'

    const allLines = content.split('\n')
    const tail = allLines.slice(-lines)
    return tail.join('\n')
  } catch (err) {
    return `Failed to read log: ${err.message}`
  }
}

/**
 * Trim log file if it gets too large
 */
function trimLog() {
  try {
    if (!fs.existsSync(LOG_FILE)) return
    const content = fs.readFileSync(LOG_FILE, 'utf-8')
    const lines = content.split('\n')
    if (lines.length > MAX_LOG_LINES) {
      const trimmed = lines.slice(-MAX_LOG_LINES).join('\n')
      fs.writeFileSync(LOG_FILE, trimmed, 'utf-8')
    }
  } catch {}
}

/**
 * Register the debug logger feature
 */
export function register(gw) {
  gateway = gw

  // Hook console immediately (captures errors even when debug is off — only forwards when on)
  hookConsole()

  // Add /log command
  const originalExecute = gw.commandHandler.execute.bind(gw.commandHandler)

  gw.commandHandler.execute = async function (text, sessionKey, adapter, chatId) {
    const trimmed = text.trim().toLowerCase()

    if (trimmed === '/log on') {
      enabled = true
      writeLog('INFO', 'Debug logging ENABLED by user')
      return {
        handled: true,
        response: [
          '🔧 Debug logging ON',
          '',
          'Errors and warnings will be:',
          '  Sent to you here on WhatsApp',
          '  Written to workspace/debug.log',
          '',
          '/log — view recent entries',
          '/log off — disable'
        ].join('\n')
      }
    }

    if (trimmed === '/log off') {
      writeLog('INFO', 'Debug logging DISABLED by user')
      enabled = false
      return { handled: true, response: '🔧 Debug logging OFF' }
    }

    if (trimmed === '/log' || trimmed === '/log status') {
      const status = enabled ? 'ON' : 'OFF'
      const logExists = fs.existsSync(LOG_FILE)
      const logSize = logExists ? Math.round(fs.statSync(LOG_FILE).size / 1024) : 0

      const lines = [
        `🔧 Debug Logger: ${status}`,
        `Log file: ${logSize}KB`,
        ''
      ]

      if (logExists) {
        lines.push('Recent entries:')
        lines.push(tailLog(10))
      } else {
        lines.push('No log entries yet.')
      }

      lines.push('', '/log on — enable', '/log off — disable', '/log clear — wipe log file')
      return { handled: true, response: lines.join('\n') }
    }

    if (trimmed === '/log clear') {
      try {
        if (fs.existsSync(LOG_FILE)) fs.unlinkSync(LOG_FILE)
        return { handled: true, response: '🔧 Debug log cleared' }
      } catch (err) {
        return { handled: true, response: `Failed to clear log: ${err.message}` }
      }
    }

    return originalExecute(text, sessionKey, adapter, chatId)
  }

  // Trim log file periodically (every 30 min)
  setInterval(trimLog, 30 * 60 * 1000)

  // Log feature load events
  const originalLoadFeatures = gw.loadFeatures
  if (originalLoadFeatures) {
    // Already loaded by the time this plugin registers, but log that we're active
    writeLog('INFO', 'Debug logger initialized')
  }

  // Monitor agent errors
  if (gw.agentRunner) {
    gw.agentRunner.on('failed', ({ runId, error }) => {
      if (enabled) {
        const msg = `Agent run failed [${runId}]: ${error}`
        writeLog('ERROR', msg)
        sendToFrank(msg)
      }
    })

    gw.agentRunner.on('agent:tool', ({ sessionKey, name }) => {
      if (enabled) {
        writeLog('TOOL', `${name} (session: ${sessionKey.split(':').pop()})`)
      }
    })
  }

  console.log('[DebugLogger] /log on|off|clear|status commands enabled')
}
