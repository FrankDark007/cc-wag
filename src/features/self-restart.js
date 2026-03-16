import fs from 'fs'
import path from 'path'
import { spawn, execSync } from 'child_process'

/**
 * Self-Restart Feature
 * Atlas can restart itself after code changes.
 *
 * Commands:
 *   /atlas restart   - Restart Atlas process
 *   /atlas update    - Git pull + restart if changes
 *   /atlas version   - Show git commit, uptime, loaded features
 *
 * API (gateway._selfRestart):
 *   scheduleRestart(reason, delaySec)  - Schedule a delayed restart
 *   getUptime()                         - Process uptime in seconds
 *   getVersion()                        - Current git commit oneliner
 *
 * Restart methods (in priority order):
 *   1. launchctl (if com.flooddoctor.cc-wag service exists)
 *   2. Process re-spawn (detached node process + exit)
 */

const ROOT = '/Users/ghost/Projects/cc-wag'
const LAUNCHD_LABEL = 'com.flooddoctor.cc-wag'
const FRANK_CHAT_ID = '17034981581@s.whatsapp.net'

// ── Helpers ──────────────────────────────────────────────────────────

function getVersion() {
  try {
    return execSync('git log --oneline -1', { cwd: ROOT, encoding: 'utf-8' }).trim()
  } catch {
    return 'unknown'
  }
}

function getUptime() {
  return process.uptime()
}

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function countFeatures() {
  try {
    const dir = path.join(ROOT, 'src/features')
    return fs.readdirSync(dir).filter(f => f.endsWith('.js')).length
  } catch {
    return 0
  }
}

function hasLaunchdService() {
  try {
    const result = execSync(`launchctl list ${LAUNCHD_LABEL} 2>/dev/null`, { encoding: 'utf-8' })
    return result.includes(LAUNCHD_LABEL) || result.includes('PID')
  } catch {
    return false
  }
}

// ── Restart Logic ────────────────────────────────────────────────────

function doRestart() {
  if (hasLaunchdService()) {
    console.log('[SelfRestart] Restarting via launchctl...')
    try {
      // launchctl will restart the service automatically
      execSync(`launchctl kickstart -k gui/$(id -u)/${LAUNCHD_LABEL}`, { encoding: 'utf-8' })
      return // launchctl handles the restart
    } catch {
      // If kickstart fails, try stop (launchd KeepAlive will restart)
      try {
        execSync(`launchctl stop ${LAUNCHD_LABEL}`, { encoding: 'utf-8' })
        return
      } catch (err) {
        console.error('[SelfRestart] launchctl stop failed:', err.message)
      }
    }
  }

  // Fallback: spawn new process and exit
  console.log('[SelfRestart] Restarting via process spawn...')
  const child = spawn('node', ['src/gateway.js'], {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore',
    env: process.env
  })
  child.unref()
  process.exit(0)
}

function scheduleRestart(reason, delaySec, gateway) {
  const delay = (delaySec || 5) * 1000
  console.log(`[SelfRestart] Scheduled restart in ${delaySec || 5}s: ${reason}`)

  // Notify Frank
  const adapter = gateway.adapters.get('whatsapp')
  if (adapter) {
    adapter.sendMessage(FRANK_CHAT_ID, `\uD83D\uDD04 Restarting Atlas in ${delaySec || 5}s: ${reason}`)
      .catch(err => console.error('[SelfRestart] Notify failed:', err.message))
  }

  setTimeout(() => {
    doRestart()
  }, delay)
}

// ── Command Handlers ─────────────────────────────────────────────────

function handleRestart(gateway) {
  // Send message first, then restart after delay so message sends
  const adapter = gateway.adapters.get('whatsapp')
  if (adapter) {
    adapter.sendMessage(FRANK_CHAT_ID, '\uD83D\uDD04 Restarting Atlas...')
      .then(() => {
        setTimeout(() => doRestart(), 2000)
      })
      .catch(() => {
        setTimeout(() => doRestart(), 2000)
      })
  } else {
    setTimeout(() => doRestart(), 2000)
  }

  return '\uD83D\uDD04 Restarting Atlas...'
}

function handleUpdate(gateway) {
  try {
    // Check for changes first
    const fetchResult = execSync('git fetch origin main 2>&1', { cwd: ROOT, encoding: 'utf-8' })
    const diffResult = execSync('git diff HEAD..origin/main --stat 2>/dev/null', { cwd: ROOT, encoding: 'utf-8' }).trim()

    if (!diffResult) {
      return 'Already up to date. No restart needed.'
    }

    // Pull changes
    const pullResult = execSync('git pull origin main 2>&1', { cwd: ROOT, encoding: 'utf-8' }).trim()
    const changedFiles = diffResult.split('\n').length - 1 // Last line is summary

    const lines = [
      '\uD83D\uDD04 *Atlas Update*',
      '',
      `Pulled ${changedFiles} changed files:`,
      diffResult.split('\n').slice(0, 10).map(l => `\u2022 ${l.trim()}`).join('\n'),
      '',
      'Restarting in 3 seconds...'
    ]

    // Schedule restart
    setTimeout(() => doRestart(), 3000)

    return lines.join('\n')
  } catch (err) {
    return `Update failed: ${err.message}`
  }
}

function handleVersion() {
  const version = getVersion()
  const uptime = formatUptime(getUptime())
  const features = countFeatures()
  const method = hasLaunchdService() ? 'launchd' : 'process'

  return [
    '\uD83E\uDD16 *Atlas Version*',
    '\u2501'.repeat(16),
    '',
    `Commit: ${version}`,
    `Uptime: ${uptime}`,
    `Features: ${features} loaded`,
    `Restart method: ${method}`,
    `Node: ${process.version}`,
    `PID: ${process.pid}`
  ].join('\n')
}

// ── Router ───────────────────────────────────────────────────────────

function handleAtlasSelf(text, gateway) {
  const lower = text.trim().toLowerCase()

  if (lower === '/atlas restart') return handleRestart(gateway)
  if (lower === '/atlas update') return handleUpdate(gateway)
  if (lower === '/atlas version') return handleVersion()

  return null
}

// ── Register ─────────────────────────────────────────────────────────

export function register(gateway) {
  const originalExecute = gateway.commandHandler.execute.bind(gateway.commandHandler)

  gateway.commandHandler.execute = async function (text, sessionKey, adapter, chatId) {
    const lower = text.trim().toLowerCase()

    if (lower === '/atlas restart' || lower === '/atlas update' || lower === '/atlas version') {
      const response = handleAtlasSelf(text.trim(), gateway)
      if (response) return { handled: true, response }
    }

    return originalExecute(text, sessionKey, adapter, chatId)
  }

  // Expose API for other features (e.g., plugin-updater after CC session)
  gateway._selfRestart = {
    scheduleRestart(reason, delaySec) {
      scheduleRestart(reason, delaySec || 5, gateway)
    },
    getUptime,
    getVersion,
    doRestart
  }

  console.log(`[SelfRestart] Feature loaded — /atlas restart|update|version (method: ${hasLaunchdService() ? 'launchd' : 'process'})`)
}
