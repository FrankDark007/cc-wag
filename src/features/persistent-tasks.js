/**
 * Persistent Tasks — Multi-day tasks with cron-driven follow-ups
 *
 * Use cases:
 * - "Follow up with adjuster Smith every 3 days until he responds"
 * - "Remind me to check on FD-012 payment next Monday"
 * - "Track the Wigenton dispute — alert me when StateFarm emails back"
 *
 * Integrates with cron.js for scheduling and email-watcher for signal detection.
 */

import fs from 'fs'
import path from 'path'
import config from '../config.js'

const TASKS_PATH = path.join(config.paths.workspace, 'persistent-tasks.json')
const SIGNALS_PATH = path.join(config.paths.workspace, 'waiting-signals.json')

// ── State management ──

function loadTasks() {
  try {
    if (fs.existsSync(TASKS_PATH)) {
      return JSON.parse(fs.readFileSync(TASKS_PATH, 'utf-8'))
    }
  } catch (err) {
    console.error('[PersistentTasks] Failed to load:', err.message)
  }
  return { tasks: [] }
}

function saveTasks(state) {
  try {
    fs.writeFileSync(TASKS_PATH, JSON.stringify(state, null, 2))
  } catch (err) {
    console.error('[PersistentTasks] Failed to save:', err.message)
  }
}

function loadSignals() {
  try {
    if (fs.existsSync(SIGNALS_PATH)) {
      return JSON.parse(fs.readFileSync(SIGNALS_PATH, 'utf-8'))
    }
  } catch (err) {
    console.error('[PersistentTasks] Failed to load signals:', err.message)
  }
  return { signals: [] }
}

function saveSignals(state) {
  try {
    fs.writeFileSync(SIGNALS_PATH, JSON.stringify(state, null, 2))
  } catch (err) {
    console.error('[PersistentTasks] Failed to save signals:', err.message)
  }
}

// ── Task creation ──

function createTask({ type, objective, target, schedule, doneWhen, escalateAfter }) {
  const id = `pt_${Date.now().toString(36)}`
  const task = {
    id,
    type: type || 'follow-up',
    objective,
    target: target || {},
    schedule: {
      intervalDays: schedule?.intervalDays || 3,
      maxAttempts: schedule?.maxAttempts || 5,
      cronJobId: null // Set after cron registration
    },
    state: {
      status: 'active',
      attempts: 0,
      lastAttempt: null,
      escalated: false
    },
    doneWhen: doneWhen || 'Target responds or confirms',
    escalateAfter: escalateAfter || 3,
    createdAt: new Date().toISOString()
  }

  const data = loadTasks()
  data.tasks.push(task)
  saveTasks(data)

  // Register waiting signal
  if (target?.email || target?.name) {
    const signals = loadSignals()
    signals.signals.push({
      taskId: id,
      type: 'email-reply',
      match: {
        from: target.email || null,
        nameContains: target.name || null,
        subjectContains: target.jobId || null
      },
      createdAt: new Date().toISOString()
    })
    saveSignals(signals)
  }

  return task
}

function updateTaskState(taskId, updates) {
  const data = loadTasks()
  const task = data.tasks.find(t => t.id === taskId)
  if (!task) return null

  Object.assign(task.state, updates)
  saveTasks(data)
  return task
}

function completeTask(taskId, reason) {
  const data = loadTasks()
  const task = data.tasks.find(t => t.id === taskId)
  if (!task) return null

  task.state.status = 'completed'
  task.state.completedAt = new Date().toISOString()
  task.state.completionReason = reason || 'manual'

  // Remove associated cron job
  if (task.schedule.cronJobId) {
    // Cron cancellation delegated to caller
    task.schedule.cronJobId = null
  }

  saveTasks(data)

  // Remove associated signals
  const signals = loadSignals()
  signals.signals = signals.signals.filter(s => s.taskId !== taskId)
  saveSignals(signals)

  return task
}

function cancelTask(taskId) {
  return completeTask(taskId, 'cancelled')
}

// ── Command handlers ──

function listTasks() {
  const data = loadTasks()
  const active = data.tasks.filter(t => t.state.status === 'active')

  if (active.length === 0) {
    return 'No active persistent tasks.'
  }

  const lines = [`Persistent Tasks (${active.length}):`, '']

  for (const task of active) {
    const attempts = task.state.attempts
    const max = task.schedule.maxAttempts
    const escalated = task.state.escalated ? ' [ESCALATED]' : ''
    const lastAttempt = task.state.lastAttempt
      ? ` (last: ${new Date(task.state.lastAttempt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`
      : ''

    lines.push(`${task.id}: ${task.objective}`)
    lines.push(`  ${task.type} | ${attempts}/${max} attempts${lastAttempt}${escalated}`)
    lines.push(`  Done when: ${task.doneWhen}`)
    lines.push('')
  }

  const completed = data.tasks.filter(t => t.state.status === 'completed').length
  if (completed > 0) {
    lines.push(`(${completed} completed tasks in history)`)
  }

  return lines.join('\n')
}

function handleTaskCommand(taskId, action, scheduler) {
  const data = loadTasks()
  const task = data.tasks.find(t => t.id === taskId)

  if (!task) {
    return `Task ${taskId} not found.`
  }

  switch (action) {
    case 'done': {
      if (task.schedule.cronJobId && scheduler) {
        scheduler.cancel(task.schedule.cronJobId)
      }
      completeTask(taskId, 'manual')
      return `Marked done: ${task.objective}`
    }

    case 'cancel': {
      if (task.schedule.cronJobId && scheduler) {
        scheduler.cancel(task.schedule.cronJobId)
      }
      cancelTask(taskId)
      return `Cancelled: ${task.objective}`
    }

    case 'escalate': {
      updateTaskState(taskId, { escalated: true })
      return `Escalated: ${task.objective} — next follow-up will use escalation tone.`
    }

    default:
      return `Unknown action: ${action}. Use: done, cancel, escalate`
  }
}

// ── Cron execution handler ──

function handleCronFire(taskId, gateway) {
  const data = loadTasks()
  const task = data.tasks.find(t => t.id === taskId)
  if (!task || task.state.status !== 'active') return null

  task.state.attempts++
  task.state.lastAttempt = new Date().toISOString()

  // Check if max attempts reached
  if (task.state.attempts >= task.schedule.maxAttempts) {
    task.state.status = 'completed'
    task.state.completionReason = 'max-attempts'
    saveTasks(data)

    return {
      message: `Persistent task "${task.objective}" reached max attempts (${task.schedule.maxAttempts}). No response received. Task auto-closed.`,
      invokeAgent: false
    }
  }

  // Check if should escalate
  if (task.state.attempts >= task.escalateAfter && !task.state.escalated) {
    task.state.escalated = true
  }

  saveTasks(data)

  // Build follow-up message for agent
  const tone = task.state.escalated ? 'firm but professional' : 'friendly'
  const attemptInfo = `Attempt ${task.state.attempts}/${task.schedule.maxAttempts}`

  return {
    message: `[Persistent Task ${task.id}] ${attemptInfo}: Follow up on "${task.objective}". Target: ${task.target.name || 'unknown'}${task.target.email ? ' (' + task.target.email + ')' : ''}. Tone: ${tone}. ${task.target.jobId ? 'Job: ' + task.target.jobId + '.' : ''} Check if the done-condition is already met before sending: "${task.doneWhen}"`,
    invokeAgent: true
  }
}

// ── Signal checking ──

/**
 * Check if any waiting signals have been resolved.
 * Called by email-watcher or other plugins that detect external events.
 */
function checkSignals(event) {
  const signals = loadSignals()
  const resolved = []

  for (const signal of signals.signals) {
    if (signal.type === 'email-reply') {
      const match = signal.match
      let matched = false

      if (match.from && event.from && event.from.toLowerCase().includes(match.from.toLowerCase())) {
        matched = true
      }
      if (match.nameContains && event.from && event.from.toLowerCase().includes(match.nameContains.toLowerCase())) {
        matched = true
      }

      if (matched) {
        resolved.push(signal)
      }
    }
  }

  // Auto-resolve tasks for matched signals
  for (const signal of resolved) {
    completeTask(signal.taskId, 'signal-resolved')
    console.log(`[PersistentTasks] Signal resolved for task ${signal.taskId}`)
  }

  // Clean up resolved signals
  if (resolved.length > 0) {
    signals.signals = signals.signals.filter(s => !resolved.find(r => r.taskId === s.taskId))
    saveSignals(signals)
  }

  return resolved
}

// ── Plugin registration ──

export function register(gateway) {
  const scheduler = gateway.agentRunner.agent.cronScheduler

  // Expose on gateway for command handler access
  gateway._persistentTasks = {
    listTasks,
    handleTaskCommand: (taskId, action) => handleTaskCommand(taskId, action, scheduler),
    createTask,
    checkSignals
  }

  // Listen for cron executions that match persistent task patterns
  scheduler.on('execute', ({ jobId, message }) => {
    // Check if this cron job belongs to a persistent task
    if (message && message.startsWith('[PersistentTask:')) {
      const taskIdMatch = message.match(/\[PersistentTask:(pt_\w+)\]/)
      if (taskIdMatch) {
        const result = handleCronFire(taskIdMatch[1], gateway)
        if (result) {
          console.log(`[PersistentTasks] Cron fired for ${taskIdMatch[1]}: attempt ${result.message}`)
        }
      }
    }
  })

  console.log('[PersistentTasks] Multi-day task tracking loaded')
}
