import fs from 'fs'
import path from 'path'
import { spawn, execSync } from 'child_process'

/**
 * CC Spawner Feature
 * Spawns Claude Code sessions to do autonomous work on the Atlas codebase.
 *
 * Commands:
 *   /cc spawn "<task>"   — Spawn a new CC session
 *   /cc status           — Show running/completed CC sessions
 *   /cc results [id]     — Show results from last completed session
 *   /cc kill <id>        — Kill a running CC session
 *   /cc history          — Show all past CC sessions
 *   /cc help             — Show commands
 *
 * Storage: workspace/cc-sessions.json
 */

const WORKSPACE = '/Users/ghost/Projects/cc-wag/workspace'
const PROJECT_ROOT = '/Users/ghost/Projects/cc-wag'
const SESSIONS_FILE = path.join(WORKSPACE, 'cc-sessions.json')
const FRANK_CHAT_ID = '17034981581@s.whatsapp.net'
const MAX_WA_OUTPUT = 500
const AUDIT_FILE = path.join(WORKSPACE, 'cc-audit.jsonl')

// Dangerous patterns that should never be in CC spawn tasks
const DANGEROUS_PATTERNS = [
  /rm\s+-rf/i, /curl.*\|.*sh/i, /wget.*\|.*sh/i, /eval\s*\(/i,
  /process\.env/i, /ANTHROPIC_API_KEY/i, /credentials/i, /\.env\b/i,
  /auth_whatsapp/i, /ssh\s+/i, /scp\s+/i, /rsync\s+/i
]

const MAX_TASK_LENGTH = 500

function validateTask(task) {
  if (!task || typeof task !== 'string') {
    return { valid: false, reason: 'Task must be a non-empty string' }
  }
  if (task.length > MAX_TASK_LENGTH) {
    return { valid: false, reason: `Task too long (${task.length} chars, max ${MAX_TASK_LENGTH})` }
  }
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(task)) {
      return { valid: false, reason: `Task contains blocked pattern: ${pattern.source}` }
    }
  }
  return { valid: true }
}

function auditLog(entry) {
  try {
    const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + '\n'
    fs.appendFileSync(AUDIT_FILE, line)
  } catch (err) {
    console.error('[CCSpawner] Audit log failed:', err.message)
  }
}

// ── Session Storage ─────────────────────────────────────────────────

function loadSessions() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8'))
    }
  } catch (err) {
    console.error('[CCSpawner] Failed to load sessions:', err.message)
  }
  return { sessions: [] }
}

function saveSessions(data) {
  const dir = path.dirname(SESSIONS_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2))
}

function saveSession(sessionId, updates) {
  const data = loadSessions()
  const idx = data.sessions.findIndex(s => s.id === sessionId)
  if (idx >= 0) {
    Object.assign(data.sessions[idx], updates)
  } else {
    data.sessions.push({ id: sessionId, ...updates })
  }
  saveSessions(data)
}

// ── Notification ────────────────────────────────────────────────────

async function notifyFrank(message, gateway) {
  try {
    const adapter = gateway.adapters?.get('whatsapp') || gateway.adapter
    if (adapter) {
      await adapter.sendMessage(FRANK_CHAT_ID, message)
    }
  } catch (err) {
    console.error('[CCSpawner] Failed to notify:', err.message)
  }
}

// ── Prompt Builder ──────────────────────────────────────────────────

function buildPrompt(task) {
  return `You are working on the Atlas WhatsApp AI assistant codebase at ${PROJECT_ROOT}.

PROJECT: Atlas — WhatsApp AI assistant for Flood Doctor restoration company.
ARCHITECTURE: ESM Node.js project. Features in src/features/ export register(gateway).
KEY FILES:
- src/gateway.js — main entry, loads features
- src/features/ — plugin directory (auto-loaded)
- workspace/ — data files (jobs.json, equipment.json, etc.)
- src/utils/job-data.js — shared utilities

TASK: ${task}

RULES:
- Follow existing code patterns
- Commit changes when done
- Do not break existing features
- Test with node -c for syntax

Do the task and commit.`
}

// ── Spawn CC Session ────────────────────────────────────────────────

// Track running processes in memory (PIDs for kill support)
const runningProcesses = new Map()

function spawnCCSession(taskDescription, gateway) {
  const sessionId = `cc-${Date.now()}`
  const prompt = buildPrompt(taskDescription)

  // Record session as running
  saveSession(sessionId, {
    task: taskDescription,
    status: 'running',
    startedAt: new Date().toISOString(),
    completedAt: null,
    exitCode: null,
    output: '',
    pid: null
  })

  // Spawn claude CLI in non-interactive mode
  const proc = spawn('claude', [
    '--print',
    '--dangerously-skip-permissions',
    prompt
  ], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY },
    stdio: ['pipe', 'pipe', 'pipe']
  })

  // Store PID
  if (proc.pid) {
    runningProcesses.set(sessionId, proc)
    saveSession(sessionId, { pid: proc.pid })
  }

  let output = ''

  proc.stdout.on('data', (data) => {
    output += data.toString()
  })

  proc.stderr.on('data', (data) => {
    output += data.toString()
  })

  proc.on('close', async (code) => {
    runningProcesses.delete(sessionId)

    // Capture recent git commits
    let gitLog = ''
    try {
      gitLog = execSync('git log --oneline -3', {
        cwd: PROJECT_ROOT,
        timeout: 5000,
        encoding: 'utf-8',
        stdio: 'pipe'
      }).trim()
    } catch {
      // git not available or no commits
    }

    // Save result
    saveSession(sessionId, {
      status: code === 0 ? 'completed' : 'failed',
      completedAt: new Date().toISOString(),
      exitCode: code,
      output,
      gitLog
    })

    // Notify Frank via WhatsApp
    const statusIcon = code === 0 ? 'Success' : 'Failed'
    const truncOutput = output.length > MAX_WA_OUTPUT
      ? '...' + output.slice(-MAX_WA_OUTPUT)
      : output
    const summary = [
      `*CC Session Complete*`,
      `Task: ${taskDescription}`,
      `Status: ${statusIcon} (exit ${code})`,
      gitLog ? `\nRecent commits:\n${gitLog}` : '',
      `\nRun /cc results for details`
    ].filter(Boolean).join('\n')

    await notifyFrank(summary, gateway)
    console.log(`[CCSpawner] Session ${sessionId} completed (exit ${code})`)
  })

  proc.on('error', async (err) => {
    runningProcesses.delete(sessionId)
    saveSession(sessionId, {
      status: 'error',
      completedAt: new Date().toISOString(),
      exitCode: -1,
      output: `Spawn error: ${err.message}`
    })

    await notifyFrank(`*CC Session Error*\nTask: ${taskDescription}\nError: ${err.message}`, gateway)
    console.error(`[CCSpawner] Session ${sessionId} spawn error:`, err.message)
  })

  return sessionId
}

// ── Command Handlers ────────────────────────────────────────────────

function handleCCSpawn(taskDescription, gateway) {
  if (!taskDescription) {
    return 'Usage: /cc spawn "<task description>"\nExample: /cc spawn "fix the revenue dashboard to include disputes"'
  }

  // Strip surrounding quotes
  const task = taskDescription.replace(/^["']|["']$/g, '').trim()
  if (!task) {
    return 'Please provide a task description.'
  }

  // Validate task
  const validation = validateTask(task)
  if (!validation.valid) {
    auditLog({ task, result: 'rejected', reason: validation.reason })
    return `Task rejected: ${validation.reason}`
  }

  const sessionId = spawnCCSession(task, gateway)
  auditLog({ task, sessionId, result: 'spawned' })
  return [
    `*CC Session Spawned*`,
    `ID: ${sessionId}`,
    `Task: ${task}`,
    '',
    'Claude Code is working on it. You\'ll get a WhatsApp notification when done.',
    'Use /cc status to check progress.'
  ].join('\n')
}

function handleCCStatus() {
  const data = loadSessions()
  if (data.sessions.length === 0) {
    return 'No CC sessions found. Use /cc spawn "<task>" to start one.'
  }

  const running = data.sessions.filter(s => s.status === 'running')
  const recent = data.sessions
    .filter(s => s.status !== 'running')
    .slice(-5)
    .reverse()

  const lines = ['*CC Sessions*', '']

  if (running.length > 0) {
    lines.push(`*Running (${running.length}):*`)
    for (const s of running) {
      const elapsed = Math.round((Date.now() - new Date(s.startedAt).getTime()) / 60000)
      lines.push(`  ${s.id} — ${elapsed}m — ${truncate(s.task, 50)}`)
    }
    lines.push('')
  }

  if (recent.length > 0) {
    lines.push(`*Recent (${recent.length}):*`)
    for (const s of recent) {
      const icon = s.status === 'completed' ? 'OK' : 'FAIL'
      lines.push(`  ${s.id} — ${icon} — ${truncate(s.task, 50)}`)
    }
  }

  return lines.join('\n')
}

function handleCCResults(targetId) {
  const data = loadSessions()
  if (data.sessions.length === 0) {
    return 'No CC sessions found.'
  }

  let session
  if (targetId) {
    session = data.sessions.find(s => s.id === targetId)
    if (!session) {
      // Try partial match
      session = data.sessions.find(s => s.id.includes(targetId))
    }
  } else {
    // Last completed session
    session = [...data.sessions].reverse().find(s => s.status !== 'running')
  }

  if (!session) {
    return 'No matching session found. Use /cc history to see all sessions.'
  }

  const output = session.output || '(no output)'
  const truncOutput = output.length > 2000
    ? output.slice(0, 1000) + '\n\n... truncated ...\n\n' + output.slice(-1000)
    : output

  const lines = [
    `*CC Session Results*`,
    `ID: ${session.id}`,
    `Task: ${session.task}`,
    `Status: ${session.status} (exit ${session.exitCode})`,
    `Started: ${session.startedAt}`,
    `Completed: ${session.completedAt || 'N/A'}`,
  ]

  if (session.gitLog) {
    lines.push('')
    lines.push('*Git commits:*')
    lines.push(session.gitLog)
  }

  lines.push('')
  lines.push('*Output:*')
  lines.push(truncOutput)

  return lines.join('\n')
}

function handleCCKill(targetId) {
  if (!targetId) {
    return 'Usage: /cc kill <session-id>'
  }

  // Check in-memory processes first
  const proc = runningProcesses.get(targetId)
  if (proc) {
    try {
      proc.kill('SIGTERM')
      runningProcesses.delete(targetId)
      saveSession(targetId, {
        status: 'killed',
        completedAt: new Date().toISOString(),
        exitCode: -1
      })
      return `Session ${targetId} killed.`
    } catch (err) {
      return `Failed to kill session: ${err.message}`
    }
  }

  // Try by PID from stored session
  const data = loadSessions()
  const session = data.sessions.find(s => s.id === targetId || s.id.includes(targetId))
  if (!session) return `Session not found: ${targetId}`

  if (session.status !== 'running') {
    return `Session ${session.id} is not running (status: ${session.status})`
  }

  if (session.pid) {
    try {
      process.kill(session.pid, 'SIGTERM')
      saveSession(session.id, {
        status: 'killed',
        completedAt: new Date().toISOString(),
        exitCode: -1
      })
      return `Session ${session.id} killed (PID ${session.pid}).`
    } catch (err) {
      // Process might already be dead
      saveSession(session.id, {
        status: 'killed',
        completedAt: new Date().toISOString(),
        exitCode: -1
      })
      return `Session ${session.id} marked as killed (process may have already exited).`
    }
  }

  return `Cannot kill session ${session.id}: no PID recorded.`
}

function handleCCHistory() {
  const data = loadSessions()
  if (data.sessions.length === 0) {
    return 'No CC session history.'
  }

  const lines = [`*CC Session History* (${data.sessions.length} total)`, '']

  // Show all sessions, newest first
  const sorted = [...data.sessions].reverse()
  for (const s of sorted) {
    const icon = s.status === 'completed' ? 'OK' : s.status === 'running' ? 'RUN' : 'FAIL'
    const date = s.startedAt ? new Date(s.startedAt).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    }) : 'N/A'
    lines.push(`${icon} | ${date} | ${truncate(s.task, 40)}`)
    lines.push(`    ID: ${s.id}`)
  }

  return lines.join('\n')
}

function handleCCHelp() {
  return [
    '*CC Spawner Commands*',
    '',
    '/cc spawn "<task>" -- Spawn a new CC session',
    '/cc status -- Show running/completed sessions',
    '/cc results [id] -- Show results from a session',
    '/cc kill <id> -- Kill a running session',
    '/cc history -- Show all past sessions',
    '/cc help -- This help message',
    '',
    '*Examples:*',
    '/cc spawn "fix the revenue dashboard to include disputes"',
    '/cc spawn "add input validation to the intake-bot"',
    '/cc status',
    '/cc results',
    '/cc kill cc-1710662400000'
  ].join('\n')
}

// ── Helpers ─────────────────────────────────────────────────────────

function truncate(str, maxLen) {
  if (!str) return ''
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen - 3) + '...'
}

// ── Command Router ──────────────────────────────────────────────────

async function handleCCCommand(text, sessionKey, adapter, chatId, gateway) {
  const rest = text.slice(3).trim() // strip "/cc"
  const lower = rest.toLowerCase()

  // /cc (no args) or /cc help
  if (!rest || lower === 'help') {
    return handleCCHelp()
  }

  // /cc spawn "<task>"
  if (lower.startsWith('spawn')) {
    const taskDesc = rest.slice(5).trim()
    return handleCCSpawn(taskDesc, gateway)
  }

  // /cc status
  if (lower === 'status') {
    return handleCCStatus()
  }

  // /cc results [id]
  if (lower.startsWith('results')) {
    const targetId = rest.slice(7).trim() || null
    return handleCCResults(targetId)
  }

  // /cc kill <id>
  if (lower.startsWith('kill')) {
    const targetId = rest.slice(4).trim()
    return handleCCKill(targetId)
  }

  // /cc history
  if (lower === 'history') {
    return handleCCHistory()
  }

  return 'Unknown /cc command. Try /cc help'
}

// ── Plugin Registration ─────────────────────────────────────────────

export function register(gateway) {
  const originalExecute = gateway.commandHandler.execute.bind(gateway.commandHandler)

  gateway.commandHandler.execute = async function (text, sessionKey, adapter, chatId) {
    const cmd = text.trim().toLowerCase()

    if (cmd.startsWith('/cc')) {
      const response = await handleCCCommand(text.trim(), sessionKey, adapter, chatId, gateway)
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
      '--- CC Spawner ---',
      '/cc spawn "<task>" -- Spawn Claude Code session',
      '/cc status -- Running/completed sessions',
      '/cc results -- Last session output',
      '/cc kill <id> -- Kill running session',
      '/cc history -- All sessions',
    ]
    result.response += '\n' + lines.join('\n')
    return result
  }

  console.log('[CCSpawner] Feature loaded -- /cc commands enabled')
}
