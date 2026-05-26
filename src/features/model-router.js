/**
 * Smart Model Routing
 * Routes messages to optimal Claude model based on complexity:
 * - Haiku: greetings, short questions, confirmations, simple lookups
 * - Opus: all other messages (default)
 */

const HAIKU = 'claude-haiku-4-5-20251001'
const OPUS = 'claude-opus-4-7'

// Patterns that indicate a simple message (Haiku-eligible)
const SIMPLE_PATTERNS = [
  /^(hi|hey|hello|yo|sup|gm|good morning|good night|gn|thanks|thank you|thx|ok|okay|yes|no|yep|nope|sure|cool|got it|sounds good|perfect|great|bye|later|ttyl)\b/i,
  /^(what time|what day|what date|when is|how's the weather)/i,
  /^\//, // slash commands
]

// Patterns that indicate complex reasoning (Opus-eligible)
const COMPLEX_PATTERNS = [
  /\b(analyze|analysis|compare|evaluate|audit|strategy|architect)\b/i,
  /\b(explain why|how does .+ work|what are the pros and cons|break down)\b/i,
  /\b(insurance claim|xactimate|scope sheet|estimate review|line item)\b/i,
  /\b(create a detailed|prepare a comprehensive)\b/i,
]

// Batch/sequence patterns for task complexity (inlined from task-planner)
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

// Word count thresholds
const SHORT_MSG_WORDS = 8   // Haiku gate: up to 8 words for simple messages
const LONG_MSG_WORDS = 150  // Opus gate: 150+ words (was 50)

/**
 * Classify a message and return the optimal model
 * Default is Opus. Haiku for greetings/commands only.
 */
export function classifyMessage(text) {
  const trimmed = text.trim()
  const wordCount = trimmed.split(/\s+/).length

  // Pure greetings/acknowledgments/commands → Haiku (expanded to 8 words)
  for (const pattern of SIMPLE_PATTERNS) {
    if (pattern.test(trimmed) && wordCount <= SHORT_MSG_WORDS && !trimmed.startsWith('/')) {
      return { model: HAIKU, reason: 'greeting' }
    }
  }

  // Slash commands always Haiku (routing handled by command handler)
  if (trimmed.startsWith('/')) {
    return { model: HAIKU, reason: 'command' }
  }

  // Complex pattern match → Opus (narrowed patterns)
  for (const pattern of COMPLEX_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { model: OPUS, reason: 'complex' }
    }
  }

  // Very long messages need more reasoning → Opus
  if (wordCount >= LONG_MSG_WORDS) {
    return { model: OPUS, reason: 'long' }
  }

  // Batch/sequence detection: complex tasks → Opus
  for (const pattern of BATCH_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { model: OPUS, reason: 'batch' }
    }
  }
  for (const pattern of SEQUENCE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { model: OPUS, reason: 'sequence' }
    }
  }
  if (wordCount > 40) {
    const verbMatches = trimmed.match(ACTION_VERBS) || []
    const uniqueVerbs = new Set(verbMatches.map(v => v.toLowerCase()))
    if (uniqueVerbs.size >= 2) {
      return { model: OPUS, reason: 'multi-action' }
    }
  }

  // Everything else → Opus (default)
  return { model: OPUS, reason: 'default' }
}

/**
 * Register the model router feature
 * Hooks into the agent runner to set model per-message
 */
export function register(gateway) {
  const agent = gateway.agentRunner.agent
  const provider = agent.provider

  // Store the original run method
  const originalRun = agent.run.bind(agent)

  // Wrap run() to inject model routing
  agent.run = function (params) {
    // Only auto-route if no manual model override is set
    if (!provider.currentModel) {
      const { model, reason } = classifyMessage(params.message || '')
      provider.setModel(model)
      console.log(`[ModelRouter] ${reason} → ${model.split('-').slice(1, -1).join('-')}`)

      // Reset after this run so manual /model selection sticks
      const resetModel = () => {
        provider.currentModel = null
      }

      // Wrap the generator to reset after completion
      const gen = originalRun(params)
      // Safety timeout: reset model even if generator is abandoned/GC'd
      const safetyTimer = setTimeout(() => {
        if (provider.currentModel) {
          console.warn('[ModelRouter] Safety timeout — resetting model after 5min')
          resetModel()
        }
      }, 5 * 60 * 1000)

      return (async function* () {
        try {
          for await (const chunk of gen) {
            yield chunk
          }
        } finally {
          clearTimeout(safetyTimer)
          resetModel()
        }
      })()
    }

    return originalRun(params)
  }

  console.log('[ModelRouter] Smart model routing enabled (Haiku/Opus)')
}
