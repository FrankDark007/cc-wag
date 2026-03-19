/**
 * Work Delegator Feature
 * Detects heavy work requests and auto-delegates to CC sessions (free on Max subscription).
 *
 * Instead of Atlas processing code/development tasks inline (expensive API calls),
 * this feature intercepts them and spawns CC sessions via the cc-spawner.
 *
 * Patterns detected:
 * - "fix the...", "add a feature...", "refactor...", "implement..."
 * - Code requests, debugging, build tasks
 * - File creation/modification requests for the codebase
 *
 * Atlas tells Frank: "Delegating to CC session. I'll notify you when done."
 * CC spawner runs under Max subscription = free.
 */

// Patterns that indicate work better suited for a CC session
const DELEGATION_PATTERNS = [
  /\b(fix|patch|repair)\s+(the|this|that|a)\s+/i,
  /\b(add|implement|create|build|write)\s+(a\s+)?(new\s+)?(feature|plugin|module|endpoint|handler|component)/i,
  /\b(refactor|rewrite|restructure|reorganize)\s+(the|this|that)/i,
  /\b(debug|troubleshoot|investigate)\s+(the|this|that|why)/i,
  /\b(update|modify|change)\s+(the|this|that)\s+\w+\s+(code|file|module|script|function)/i,
  /\b(deploy|push|release|ship)\s+(the|this|that|a)/i,
  /\b(install|setup|configure)\s+(a\s+)?(new\s+)?\w+\s+(package|dependency|library|tool)/i,
  /\b(run|execute)\s+(the|a|this)\s+(test|build|migration|script)/i,
]

// Patterns that should NOT be delegated (even if they match above)
const KEEP_INLINE_PATTERNS = [
  /\b(what|how|why|when|where|who|explain|tell me|describe)\b/i,  // questions
  /\b(send|email|message|text|call|schedule|remind)\b/i,           // communication tasks
  /\b(check|look up|find|search|show|list|get)\b/i,               // lookups
  /\b(remember|note|save|store)\b/i,                               // memory tasks
]

function shouldDelegate(message) {
  const text = message.trim()

  // Too short = not a work task
  if (text.split(/\s+/).length < 5) return false

  // Check if it's a question/lookup (keep inline)
  for (const pattern of KEEP_INLINE_PATTERNS) {
    if (pattern.test(text)) return false
  }

  // Check if it matches delegation patterns
  for (const pattern of DELEGATION_PATTERNS) {
    if (pattern.test(text)) {
      return true
    }
  }

  return false
}

function extractTask(message) {
  // Clean up the message into a task description
  let task = message.trim()

  // Remove Atlas/CC prefix if present
  task = task.replace(/^(atlas|cc)[,:\s]+/i, '').trim()

  // Cap at 500 chars (cc-spawner limit)
  if (task.length > 500) {
    task = task.substring(0, 497) + '...'
  }

  return task
}

export function register(gateway) {
  // Hook into message processing — intercept before agent runs
  const originalOnMessage = gateway.setupAdapter.bind(gateway)

  // Store reference for other features
  gateway._workDelegator = {
    shouldDelegate,
    extractTask,
    enabled: true
  }

  // Hook into agent runner to intercept heavy work before Claude processes it
  const agent = gateway.agentRunner.agent
  const originalRun = agent.run.bind(agent)

  agent._workDelegatorRun = agent.run

  // We intercept at the command level instead — cleaner approach
  const originalExecute = gateway.commandHandler.execute.bind(gateway.commandHandler)

  gateway.commandHandler.execute = async function (text, sessionKey, adapter, chatId) {
    // Only delegate if feature is enabled and cc-spawner is loaded
    if (gateway._workDelegator?.enabled && shouldDelegate(text)) {
      const task = extractTask(text)

      // Check if cc-spawner exists
      if (gateway.commandHandler.execute.toString().includes('/cc')) {
        // Delegate via /cc spawn
        console.log(`[WorkDelegator] Auto-delegating: "${task.substring(0, 60)}..."`)

        // Use the cc-spawner's command handler
        const ccResult = await originalExecute(`/cc spawn "${task}"`, sessionKey, adapter, chatId)

        if (ccResult.handled) {
          // Add delegation context to the response
          const response = 'Delegating this to a CC session (runs free on Max subscription).\n\n' +
            ccResult.response + '\n\nI\'ll notify you when it\'s done. Ask me anything else in the meantime.'
          return { handled: true, response }
        }
      }
    }

    return originalExecute(text, sessionKey, adapter, chatId)
  }

  // Register /delegate command for manual control
  const execute2 = gateway.commandHandler.execute.bind(gateway.commandHandler)
  gateway.commandHandler.execute = async function (text, sessionKey, adapter, chatId) {
    const cmd = text.trim().toLowerCase()

    if (cmd === '/delegate on') {
      gateway._workDelegator.enabled = true
      return { handled: true, response: 'Work delegator enabled. Heavy tasks will auto-delegate to CC sessions.' }
    }

    if (cmd === '/delegate off') {
      gateway._workDelegator.enabled = false
      return { handled: true, response: 'Work delegator disabled. All tasks processed inline.' }
    }

    if (cmd === '/delegate status') {
      return {
        handled: true,
        response: `Work delegator: ${gateway._workDelegator.enabled ? 'ON' : 'OFF'}\nAuto-delegates: code fixes, feature work, refactoring, debugging\nKeeps inline: questions, lookups, communication, memory`
      }
    }

    return execute2(text, sessionKey, adapter, chatId)
  }

  console.log('[WorkDelegator] Auto-delegation enabled for heavy work tasks')
}
