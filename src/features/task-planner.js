/**
 * Task Planner — GSD-inspired task decomposition for Atlas
 *
 * Intercepts complex requests, injects a structured plan into the system prompt,
 * tracks step progress, and reports completion to Frank.
 *
 * Classification heuristics (no LLM call):
 * - Multiple entities: "all overdue", "every adjuster", "all jobs that..."
 * - Sequence: verb chains, "then", "after that", "and also"
 * - Batch patterns: /job .* nudge all, /scope (inherently multi-step)
 * - Long messages with 2+ action verbs
 */

import fs from 'fs'
import path from 'path'
import config from '../config.js'

const ACTIVE_TASKS_PATH = path.join(config.paths.workspace, 'active-tasks.json')
const OUTCOMES_PATH = path.join(config.paths.workspace, 'task-outcomes.jsonl')

// ── Classification patterns ──

const BATCH_PATTERNS = [
  /\ball\s+(overdue|pending|unpaid|outstanding)\b/i,
  /\bevery\s+(adjuster|client|job|invoice|claim)\b/i,
  /\ball\s+jobs?\s+that\b/i,
  /\bnudge\s+all\b/i,
  /\bfollow\s+up\s+with\s+(all|every)\b/i,
  /\bsend\s+(all|each|every)\b/i,
  /\bprepare\s+(all|each|every)\b/i,
]

const SEQUENCE_PATTERNS = [
  /\bthen\b/i,
  /\bafter\s+that\b/i,
  /\band\s+also\b/i,
  /\band\s+then\b/i,
  /\bfirst\b.*\bthen\b/i,
  /\bonce\s+(done|finished|complete)\b/i,
]

const ACTION_VERBS = /\b(send|email|draft|call|check|scan|review|prepare|create|update|nudge|follow|schedule|analyze|compile|generate|notify|alert|remind)\b/gi

/**
 * Classify a message as simple (pass-through) or complex (decompose)
 * Returns: { complex: boolean, type: 'batch'|'sequence'|'multi-action'|'simple', reason: string }
 */
export function classifyComplexity(text) {
  const trimmed = text.trim()

  // Batch pattern match
  for (const pattern of BATCH_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { complex: true, type: 'batch', reason: 'batch operation detected' }
    }
  }

  // Sequence pattern match
  for (const pattern of SEQUENCE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { complex: true, type: 'sequence', reason: 'multi-step sequence detected' }
    }
  }

  // Multi-action: >40 words with 2+ distinct action verbs
  const words = trimmed.split(/\s+/)
  if (words.length > 40) {
    const verbMatches = trimmed.match(ACTION_VERBS) || []
    const uniqueVerbs = new Set(verbMatches.map(v => v.toLowerCase()))
    if (uniqueVerbs.size >= 2) {
      return { complex: true, type: 'multi-action', reason: `${uniqueVerbs.size} action verbs in long message` }
    }
  }

  return { complex: false, type: 'simple', reason: 'simple message' }
}

/**
 * Generate a plan-as-prompt injection for complex tasks.
 * This is prepended to the system prompt so Claude follows the plan structure.
 */
function generatePlanInjection(objective, type) {
  const steps = inferSteps(objective, type)
  const verification = inferVerification(objective, type)

  return {
    injection: [
      '',
      '## Active Task Plan',
      `Objective: ${objective}`,
      'Steps:',
      ...steps.map((s, i) => `${i + 1}. ${s} — Status: pending`),
      `Verification: ${verification}`,
      'Current: Step 1',
      'Report progress after each step. Do not skip verification.',
      ''
    ].join('\n'),
    steps: steps.map((desc, i) => ({ n: i + 1, desc, status: 'pending', result: null })),
    verification
  }
}

/**
 * Infer plan steps from the objective text and complexity type
 */
function inferSteps(objective, type) {
  const lower = objective.toLowerCase()

  if (type === 'batch') {
    if (lower.includes('nudge') || lower.includes('overdue') || lower.includes('invoice')) {
      return [
        'Scan jobs database for matching items (overdue/unpaid)',
        'For each match, gather contact details and context',
        'Draft appropriate messages for each recipient',
        'Send messages (email/WhatsApp as appropriate)',
        'Log outcomes and report summary'
      ]
    }
    if (lower.includes('follow up') || lower.includes('adjuster')) {
      return [
        'Identify all targets needing follow-up',
        'Check last contact date and status for each',
        'Draft follow-up messages with appropriate escalation',
        'Send follow-ups',
        'Log results and note any requiring manual attention'
      ]
    }
    // Generic batch
    return [
      'Identify all items matching the criteria',
      'Process each item according to the request',
      'Handle any errors or exceptions',
      'Report summary of results'
    ]
  }

  if (type === 'sequence') {
    // For sequence tasks, we can't infer steps well — let Claude decompose
    return [
      'Parse the full request and identify sequential steps',
      'Execute step 1 of the sequence',
      'Execute remaining steps in order',
      'Verify all steps completed successfully'
    ]
  }

  // Multi-action default
  return [
    'Identify all actions requested',
    'Execute each action',
    'Verify all actions completed',
    'Report summary'
  ]
}

/**
 * Infer verification criteria from the objective
 */
function inferVerification(objective, type) {
  const lower = objective.toLowerCase()

  if (lower.includes('nudge') || lower.includes('email') || lower.includes('send')) {
    return 'All targeted recipients contacted or explicitly skipped with reason'
  }
  if (lower.includes('follow up')) {
    return 'All follow-ups sent or rescheduled, no items silently dropped'
  }
  if (lower.includes('prepare') || lower.includes('draft')) {
    return 'All requested documents created and ready for review'
  }
  if (lower.includes('scan') || lower.includes('check') || lower.includes('review')) {
    return 'All items scanned, results reported with counts'
  }

  return 'All requested actions completed and accounted for'
}

// ── State management ──

function loadActiveTasks() {
  try {
    if (fs.existsSync(ACTIVE_TASKS_PATH)) {
      return JSON.parse(fs.readFileSync(ACTIVE_TASKS_PATH, 'utf-8'))
    }
  } catch (err) {
    console.error('[TaskPlanner] Failed to load active tasks:', err.message)
  }
  return { current: null, history: [] }
}

function saveActiveTasks(state) {
  try {
    fs.writeFileSync(ACTIVE_TASKS_PATH, JSON.stringify(state, null, 2))
  } catch (err) {
    console.error('[TaskPlanner] Failed to save active tasks:', err.message)
  }
}

function logOutcome(outcome) {
  try {
    fs.appendFileSync(OUTCOMES_PATH, JSON.stringify(outcome) + '\n')
  } catch (err) {
    console.error('[TaskPlanner] Failed to log outcome:', err.message)
  }
}

// ── Command handlers ──

function showPlan() {
  const state = loadActiveTasks()
  if (!state.current) {
    return 'No active task plan. Send a complex request to create one.'
  }

  const task = state.current
  const lines = [
    `Task Plan: ${task.objective}`,
    `Started: ${new Date(task.startedAt).toLocaleTimeString()}`,
    ''
  ]

  for (const step of task.steps) {
    const icon = step.status === 'done' ? '✓' : step.status === 'in-progress' ? '→' : '○'
    const result = step.result ? ` (${step.result})` : ''
    lines.push(`${icon} ${step.n}. ${step.desc}${result}`)
  }

  lines.push('', `Verification: ${task.verification}`)

  const completed = task.steps.filter(s => s.status === 'done').length
  lines.push(`Progress: ${completed}/${task.steps.length}`)

  return lines.join('\n')
}

function cancelPlan() {
  const state = loadActiveTasks()
  if (!state.current) {
    return 'No active task plan to cancel.'
  }

  const task = state.current
  const completed = task.steps.filter(s => s.status === 'done').length

  logOutcome({
    id: task.id,
    objective: task.objective,
    steps: task.steps.length,
    completed,
    verified: false,
    cancelled: true,
    duration_s: Math.round((Date.now() - new Date(task.startedAt).getTime()) / 1000),
    ts: new Date().toISOString()
  })

  state.history.push({ ...task, cancelledAt: new Date().toISOString() })
  if (state.history.length > 20) state.history = state.history.slice(-20)
  state.current = null
  saveActiveTasks(state)

  return `Cancelled: "${task.objective}" (${completed}/${task.steps.length} steps done)`
}

function skipStep() {
  const state = loadActiveTasks()
  if (!state.current) {
    return 'No active task plan.'
  }

  const current = state.current.steps.find(s => s.status === 'pending' || s.status === 'in-progress')
  if (!current) {
    return 'No pending steps to skip.'
  }

  current.status = 'skipped'
  current.result = 'Skipped by user'
  saveActiveTasks(state)

  return `Skipped step ${current.n}: ${current.desc}`
}

// ── Plugin registration ──

export function register(gateway) {
  const agent = gateway.agentRunner.agent
  const originalRun = agent.run.bind(agent)

  // Expose command handlers on gateway for command handler access
  gateway._taskPlanner = { showPlan, cancelPlan, skipStep }

  // Wrap agent.run() to inject plan for complex messages
  agent.run = function (params) {
    const classification = classifyComplexity(params.message || '')

    if (!classification.complex) {
      return originalRun(params)
    }

    console.log(`[TaskPlanner] Complex message detected: ${classification.type} — ${classification.reason}`)

    // Generate plan and save state
    const { injection, steps, verification } = generatePlanInjection(params.message, classification.type)

    const taskId = `task_${Date.now()}`
    const state = loadActiveTasks()

    // Archive previous task if exists
    if (state.current) {
      state.history.push(state.current)
      if (state.history.length > 20) state.history = state.history.slice(-20)
    }

    state.current = {
      id: taskId,
      objective: params.message.substring(0, 200),
      steps,
      verification,
      classification: classification.type,
      startedAt: new Date().toISOString()
    }
    saveActiveTasks(state)

    // Inject plan into the message as context prefix
    // The system prompt is built inside run(), so we prepend to the message
    const enhancedParams = {
      ...params,
      _taskPlanInjection: injection,
      _taskId: taskId
    }

    return originalRun(enhancedParams)
  }

  // Hook into buildSystemPrompt to inject task plan
  const originalBuildSystemPrompt = buildSystemPrompt_hookable(agent)

  // Listen for run completion to update task state
  agent.on('run:complete', ({ sessionKey, response }) => {
    const state = loadActiveTasks()
    if (!state.current) return

    const task = state.current

    // Simple heuristic: if run completes and we have a current task,
    // mark all pending steps as done (Claude executed them in one pass)
    let allDone = true
    for (const step of task.steps) {
      if (step.status === 'pending' || step.status === 'in-progress') {
        step.status = 'done'
      }
      if (step.status !== 'done' && step.status !== 'skipped') {
        allDone = false
      }
    }

    if (allDone) {
      // Task complete — log outcome, will be verified by task-verifier if loaded
      task.completedAt = new Date().toISOString()
      state.history.push(task)
      if (state.history.length > 20) state.history = state.history.slice(-20)
      state.current = null

      logOutcome({
        id: task.id,
        objective: task.objective,
        steps: task.steps.length,
        completed: task.steps.filter(s => s.status === 'done').length,
        skipped: task.steps.filter(s => s.status === 'skipped').length,
        verified: false, // Will be set to true by task-verifier
        duration_s: Math.round((new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime()) / 1000),
        ts: task.completedAt
      })
    }

    saveActiveTasks(state)
  })

  console.log('[TaskPlanner] Task decomposition engine loaded')
}

/**
 * Hook into buildSystemPrompt to inject task plan context.
 * Since buildSystemPrompt is a module-level function in claude-agent.js,
 * we hook via the pre-run hook on the agent's run method instead.
 * The plan injection is prepended to the user message as structured context.
 */
function buildSystemPrompt_hookable(agent) {
  // The actual injection happens in the run() wrapper above via _taskPlanInjection
  // This is a no-op placeholder for future enhancement
  return null
}
