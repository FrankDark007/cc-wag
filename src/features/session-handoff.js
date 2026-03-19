/**
 * Session Handoff — Seamless restart recovery for Atlas
 *
 * On shutdown: captures active state to workspace/HANDOFF.json
 * On startup: reads HANDOFF.json and injects recovery context
 */

import fs from 'fs'
import path from 'path'
import config from '../config.js'

const HANDOFF_PATH = path.join(config.paths.workspace, 'HANDOFF.json')
const ACTIVE_TASKS_PATH = path.join(config.paths.workspace, 'active-tasks.json')
const PERSISTENT_TASKS_PATH = path.join(config.paths.workspace, 'persistent-tasks.json')
const SIGNALS_PATH = path.join(config.paths.workspace, 'waiting-signals.json')

/**
 * Capture current Atlas state for recovery after restart
 */
function captureState() {
  const state = {
    capturedAt: new Date().toISOString(),
    reason: 'shutdown'
  }

  // Capture active task plan
  try {
    if (fs.existsSync(ACTIVE_TASKS_PATH)) {
      const tasks = JSON.parse(fs.readFileSync(ACTIVE_TASKS_PATH, 'utf-8'))
      if (tasks.current) {
        state.activeTask = {
          id: tasks.current.id,
          objective: tasks.current.objective,
          progress: `${tasks.current.steps.filter(s => s.status === 'done').length}/${tasks.current.steps.length}`,
          startedAt: tasks.current.startedAt
        }
      }
    }
  } catch { /* ignore */ }

  // Capture persistent tasks summary
  try {
    if (fs.existsSync(PERSISTENT_TASKS_PATH)) {
      const pt = JSON.parse(fs.readFileSync(PERSISTENT_TASKS_PATH, 'utf-8'))
      const active = pt.tasks.filter(t => t.state.status === 'active')
      if (active.length > 0) {
        state.persistentTasks = active.map(t => ({
          id: t.id,
          objective: t.objective,
          attempts: t.state.attempts,
          maxAttempts: t.schedule.maxAttempts,
          lastAttempt: t.state.lastAttempt
        }))
      }
    }
  } catch { /* ignore */ }

  // Capture waiting signals
  try {
    if (fs.existsSync(SIGNALS_PATH)) {
      const signals = JSON.parse(fs.readFileSync(SIGNALS_PATH, 'utf-8'))
      if (signals.signals.length > 0) {
        state.waitingSignals = signals.signals.length
      }
    }
  } catch { /* ignore */ }

  return state
}

/**
 * Write handoff state to disk
 */
function writeHandoff(state) {
  try {
    fs.writeFileSync(HANDOFF_PATH, JSON.stringify(state, null, 2))
    console.log('[SessionHandoff] State saved to HANDOFF.json')
  } catch (err) {
    console.error('[SessionHandoff] Failed to write handoff:', err.message)
  }
}

/**
 * Read and clear handoff state (called on startup)
 * Returns recovery context string or null
 */
function readAndClearHandoff() {
  try {
    if (!fs.existsSync(HANDOFF_PATH)) return null

    const state = JSON.parse(fs.readFileSync(HANDOFF_PATH, 'utf-8'))
    fs.unlinkSync(HANDOFF_PATH)

    const parts = ['[Recovery] Atlas restarted.']
    const downtime = Math.round((Date.now() - new Date(state.capturedAt).getTime()) / 60000)
    parts.push(`Downtime: ~${downtime} minutes.`)

    if (state.activeTask) {
      parts.push(`Interrupted task: "${state.activeTask.objective}" (${state.activeTask.progress} steps done). May need to resume or restart.`)
    }

    if (state.persistentTasks && state.persistentTasks.length > 0) {
      parts.push(`${state.persistentTasks.length} persistent task(s) were running. Check /tasks for status.`)
    }

    if (state.waitingSignals) {
      parts.push(`${state.waitingSignals} waiting signal(s) — some may have resolved during downtime.`)
    }

    return parts.join(' ')
  } catch (err) {
    console.error('[SessionHandoff] Failed to read handoff:', err.message)
    return null
  }
}

export function register(gateway) {
  const agent = gateway.agentRunner.agent

  // ── Startup recovery ──
  const recoveryContext = readAndClearHandoff()
  if (recoveryContext) {
    console.log(`[SessionHandoff] Recovery: ${recoveryContext}`)
    // Store recovery context for injection into first system prompt
    gateway._recoveryContext = recoveryContext
  }

  // ── Shutdown capture ──
  const handleShutdown = (signal) => {
    console.log(`[SessionHandoff] ${signal} received — capturing state`)
    const state = captureState()
    state.reason = signal
    writeHandoff(state)
  }

  // Register shutdown handlers (prepend so they run before process.exit)
  process.on('SIGTERM', () => handleShutdown('SIGTERM'))
  process.on('SIGINT', () => handleShutdown('SIGINT'))

  // Also hook into gateway.stop() if it exists
  if (gateway.stop && !gateway._originalStop) {
    gateway._originalStop = gateway.stop.bind(gateway)
    gateway.stop = async function (...args) {
      handleShutdown('stop')
      return gateway._originalStop(...args)
    }
  }

  // Inject recovery context into first run after restart
  if (recoveryContext) {
    const originalRun = agent.run.bind(agent)
    let recoveryInjected = false

    agent.run = function (params) {
      if (!recoveryInjected) {
        recoveryInjected = true
        console.log('[SessionHandoff] Injecting recovery context into first message')
        // Prepend recovery context to the user message
        const enhancedParams = {
          ...params,
          message: `${recoveryContext}\n\nUser message: ${params.message}`
        }
        return originalRun(enhancedParams)
      }
      return originalRun(params)
    }
  }

  console.log('[SessionHandoff] Startup/shutdown handoff loaded')
}
