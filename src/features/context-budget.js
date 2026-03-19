/**
 * Context Budget Manager — Token budget enforcement for system prompts
 *
 * Prevents system prompt bloat as new features inject context.
 * Wraps buildSystemPrompt flow via the agent's run method.
 *
 * Priority tiers:
 * 1. Always: Core identity + date/time + active task plan + verification
 * 2. Tier 1: Relevant observations (cap at 4)
 * 3. Tier 2: Today's daily notes
 * 4. Tier 3: MEMORY.md (relevant sections only)
 * 5. Tier 4: Yesterday's notes (drop if over budget)
 * 6. Tier 5: Business context, cron docs, tool docs (static, compress)
 *
 * Budget targets (character counts, ~4 chars per token):
 * - Haiku:  <8K chars   (~2K tokens)
 * - Sonnet: <24K chars  (~6K tokens)
 * - Opus:   <48K chars  (~12K tokens)
 */

const BUDGET_CHARS = {
  haiku: 8000,
  sonnet: 24000,
  opus: 48000
}

/**
 * Get model tier from model name string
 */
function getModelTier(modelName) {
  if (!modelName) return 'sonnet'
  const lower = modelName.toLowerCase()
  if (lower.includes('haiku')) return 'haiku'
  if (lower.includes('opus')) return 'opus'
  return 'sonnet'
}

/**
 * Trim a system prompt to fit within the character budget.
 * Uses section-aware trimming: removes lowest-priority sections first.
 */
function enforcebudget(systemPrompt, modelTier) {
  const budget = BUDGET_CHARS[modelTier] || BUDGET_CHARS.sonnet

  if (systemPrompt.length <= budget) {
    return systemPrompt
  }

  console.log(`[ContextBudget] Prompt ${systemPrompt.length} chars exceeds ${modelTier} budget ${budget} — trimming`)

  // Split into sections by ## headers
  const sections = splitSections(systemPrompt)

  // Priority classification (lowest priority trimmed first)
  const priorityMap = {
    // Tier 5 — lowest priority
    'business context': 5,
    'cron': 5,
    'tool': 5,
    'gateway tools': 5,
    'cron tools': 5,
    'scheduled jobs': 5,
    'google tasks': 5,
    // Tier 4
    'yesterday': 4,
    // Tier 3
    'memory': 3,
    'memory context': 3,
    // Tier 2
    'today': 2,
    'daily': 2,
    // Tier 1
    'observation': 1,
    'relevant observations': 1,
    // Always — never trim
    'active task plan': 0,
    'verification': 0,
  }

  function getSectionPriority(header) {
    const lower = header.toLowerCase()
    for (const [key, priority] of Object.entries(priorityMap)) {
      if (lower.includes(key)) return priority
    }
    return 3 // Default: medium priority
  }

  // Sort sections by priority descending (trim highest number first)
  const prioritized = sections.map(s => ({
    ...s,
    priority: getSectionPriority(s.header)
  })).sort((a, b) => b.priority - a.priority)

  // Trim sections from lowest priority until under budget
  let currentLength = systemPrompt.length
  const trimmedSections = new Set()

  for (const section of prioritized) {
    if (currentLength <= budget) break
    if (section.priority === 0) continue // Never trim priority 0

    // For priority 5: compress rather than remove
    if (section.priority === 5 && section.content.length > 200) {
      const savings = section.content.length - 100
      section.content = section.content.substring(0, 100) + '...'
      currentLength -= savings
      trimmedSections.add(section.header)
      continue
    }

    // For priority 4+: remove entirely
    if (section.priority >= 4) {
      currentLength -= section.content.length + section.header.length + 4 // ## + \n\n
      trimmedSections.add(section.header)
      section.removed = true
      continue
    }

    // For priority 1-3: truncate to half
    if (section.content.length > 500) {
      const savings = Math.floor(section.content.length / 2)
      section.content = section.content.substring(0, section.content.length - savings) + '\n[truncated]'
      currentLength -= savings
      trimmedSections.add(section.header)
    }
  }

  if (trimmedSections.size > 0) {
    console.log(`[ContextBudget] Trimmed sections: ${[...trimmedSections].join(', ')}`)
  }

  // Reassemble
  const result = sections
    .filter(s => !s.removed)
    .map(s => s.header ? `## ${s.header}\n${s.content}` : s.content)
    .join('\n\n')

  // Final hard truncation if still over budget
  if (result.length > budget) {
    console.warn(`[ContextBudget] Hard truncation: ${result.length} → ${budget} chars`)
    return result.substring(0, budget)
  }

  return result
}

/**
 * Split a system prompt into sections by ## headers
 */
function splitSections(text) {
  const sections = []
  const lines = text.split('\n')
  let currentHeader = ''
  let currentContent = []

  for (const line of lines) {
    const headerMatch = line.match(/^##\s+(.+)/)
    if (headerMatch) {
      // Save previous section
      if (currentContent.length > 0 || currentHeader) {
        sections.push({ header: currentHeader, content: currentContent.join('\n') })
      }
      currentHeader = headerMatch[1]
      currentContent = []
    } else {
      currentContent.push(line)
    }
  }

  // Save last section
  if (currentContent.length > 0 || currentHeader) {
    sections.push({ header: currentHeader, content: currentContent.join('\n') })
  }

  return sections
}

export function register(gateway) {
  const agent = gateway.agentRunner.agent
  const provider = agent.provider

  // Intercept run to enforce budget on system prompts
  const originalRun = agent.run.bind(agent)

  agent.run = function (params) {
    // We can't directly intercept buildSystemPrompt (module-level function),
    // but we can wrap the provider.query to intercept systemPrompt
    const origQuery = provider.query.bind(provider)

    provider.query = function (queryParams) {
      if (queryParams.systemPrompt) {
        const currentModel = provider.currentModel || process.env.CLAUDE_MODEL || ''
        const tier = getModelTier(currentModel)
        const original = queryParams.systemPrompt.length
        queryParams.systemPrompt = enforcebudget(queryParams.systemPrompt, tier)
        const trimmed = queryParams.systemPrompt.length

        if (trimmed < original) {
          console.log(`[ContextBudget] ${tier}: ${original} → ${trimmed} chars (saved ${original - trimmed})`)
        }
      }

      // Restore original query after use
      provider.query = origQuery
      return origQuery(queryParams)
    }

    return originalRun(params)
  }

  console.log('[ContextBudget] Token budget enforcement loaded')
}
