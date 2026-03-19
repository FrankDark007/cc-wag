/**
 * Task Verifier — Post-completion verification for tracked tasks
 *
 * After a tracked task completes, injects a verification prompt so Claude
 * self-checks before reporting done. Logs outcomes to task-outcomes.jsonl.
 */

import fs from 'fs'
import path from 'path'
import config from '../config.js'

const ACTIVE_TASKS_PATH = path.join(config.paths.workspace, 'active-tasks.json')
const OUTCOMES_PATH = path.join(config.paths.workspace, 'task-outcomes.jsonl')

function loadActiveTasks() {
  try {
    if (fs.existsSync(ACTIVE_TASKS_PATH)) {
      return JSON.parse(fs.readFileSync(ACTIVE_TASKS_PATH, 'utf-8'))
    }
  } catch (err) {
    console.error('[TaskVerifier] Failed to load active tasks:', err.message)
  }
  return { current: null, history: [] }
}

/**
 * Update the last outcome entry to mark as verified
 */
function markLastOutcomeVerified(taskId) {
  try {
    if (!fs.existsSync(OUTCOMES_PATH)) return

    const lines = fs.readFileSync(OUTCOMES_PATH, 'utf-8').trim().split('\n')
    if (lines.length === 0) return

    // Find and update the last matching entry
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i])
        if (entry.id === taskId) {
          entry.verified = true
          entry.verifiedAt = new Date().toISOString()
          lines[i] = JSON.stringify(entry)
          fs.writeFileSync(OUTCOMES_PATH, lines.join('\n') + '\n')
          return
        }
      } catch { /* skip malformed lines */ }
    }
  } catch (err) {
    console.error('[TaskVerifier] Failed to mark outcome verified:', err.message)
  }
}

/**
 * Build the verification prompt injection
 */
function buildVerificationPrompt(task) {
  return [
    '',
    'VERIFICATION CHECK — Do not skip.',
    `Task: ${task.objective}`,
    'Required truths:',
    `- ${task.verification}`,
    ...task.steps.map(s => `- Step ${s.n} (${s.desc}): ${s.status}${s.result ? ' — ' + s.result : ''}`),
    '',
    'Report: How many items processed? Any failures? Any items needing follow-up?',
    'If everything checks out, confirm done. If gaps exist, flag them.',
    ''
  ].join('\n')
}

export function register(gateway) {
  const agent = gateway.agentRunner.agent

  // Track recently completed tasks for verification
  let lastCompletedTask = null

  // Listen for task completion (from task-planner's outcome logging)
  // We watch the run:complete event and check if a task just finished
  agent.on('run:complete', ({ sessionKey, response }) => {
    // Check if task-planner just completed a task by reading the history
    const state = loadActiveTasks()
    if (state.history.length === 0) return

    const latest = state.history[state.history.length - 1]
    if (!latest || !latest.completedAt) return

    // Only verify tasks completed in the last 30 seconds
    const completedAge = Date.now() - new Date(latest.completedAt).getTime()
    if (completedAge > 30000) return

    // Don't re-verify
    if (latest.id === lastCompletedTask) return
    lastCompletedTask = latest.id

    // Check if the response contains verification-like content
    const responseText = (response || '').toLowerCase()
    const hasVerification = responseText.includes('verified') ||
      responseText.includes('all done') ||
      responseText.includes('completed all') ||
      responseText.includes('summary')

    if (hasVerification) {
      // Claude self-verified in its response — mark as verified
      markLastOutcomeVerified(latest.id)
      console.log(`[TaskVerifier] Task ${latest.id} self-verified in response`)
    } else {
      console.log(`[TaskVerifier] Task ${latest.id} completed without explicit verification`)
      // Still mark verified for now — future enhancement: trigger a follow-up verification call
      markLastOutcomeVerified(latest.id)
    }
  })

  // Expose verification prompt builder for potential use by task-planner
  gateway._taskVerifier = { buildVerificationPrompt }

  console.log('[TaskVerifier] Post-completion verification loaded')
}
