/**
 * Smart Model Routing
 * Routes messages to optimal Claude model based on complexity:
 * - Haiku: greetings, short questions, confirmations, simple lookups
 * - Sonnet: most messages (default) — tasks, emails, scheduling
 * - Opus: analysis, planning, multi-step reasoning, long documents
 */

const HAIKU = 'claude-haiku-4-5-20251001'
const SONNET = 'claude-sonnet-4-5-20250929'
const OPUS = 'claude-opus-4-6'

// Patterns that indicate a simple message (Haiku-eligible)
const SIMPLE_PATTERNS = [
  /^(hi|hey|hello|yo|sup|gm|good morning|good night|gn|thanks|thank you|thx|ok|okay|yes|no|yep|nope|sure|cool|got it|sounds good|perfect|great|bye|later|ttyl)\b/i,
  /^(what time|what day|what date|when is|how's the weather)/i,
  /^\//, // slash commands
]

// Patterns that indicate complex reasoning (Opus-eligible)
const COMPLEX_PATTERNS = [
  /\b(analyze|analysis|compare|evaluate|review|audit|strategy|plan|design|architect)\b/i,
  /\b(write me a|draft a|compose a|create a detailed|prepare a)\b/i,
  /\b(explain why|how does .+ work|what are the pros and cons|break down)\b/i,
  /\b(insurance claim|xactimate|scope|estimate|line item)\b/i,
  /\b(code|debug|implement|refactor|optimize)\b/i,
]

// Word count thresholds
const SHORT_MSG_WORDS = 8
const LONG_MSG_WORDS = 50

/**
 * Classify a message and return the optimal model
 * Default is Sonnet. Haiku only for pure greetings. Opus for analysis.
 */
export function classifyMessage(text) {
  const trimmed = text.trim()
  const wordCount = trimmed.split(/\s+/).length

  // Only pure greetings/acknowledgments → Haiku (nothing that requires context)
  for (const pattern of SIMPLE_PATTERNS) {
    if (pattern.test(trimmed) && wordCount <= 4 && !trimmed.startsWith('/')) {
      return { model: HAIKU, reason: 'greeting' }
    }
  }

  // Complex pattern match → Opus
  for (const pattern of COMPLEX_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { model: OPUS, reason: 'complex' }
    }
  }

  // Long messages likely need more reasoning → Opus
  if (wordCount >= LONG_MSG_WORDS) {
    return { model: OPUS, reason: 'long' }
  }

  // Everything else → Sonnet (smart default)
  return { model: SONNET, reason: 'default' }
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

  console.log('[ModelRouter] Smart model routing enabled (Haiku/Sonnet/Opus)')
}
