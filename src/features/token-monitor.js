import fs from 'fs'
import path from 'path'
import config from '../config.js'

/**
 * Token Monitor Feature
 * Tracks API token usage and costs per message, with daily budget alerts.
 *
 * - Captures input_tokens + output_tokens from Claude API response metadata
 * - Calculates cost per message based on model used
 * - Stores daily totals in workspace/token-usage.json
 * - Daily budget alert at $10 threshold → WhatsApp notification
 * - Emergency circuit breaker at $25/day → force Haiku-only mode
 */

const USAGE_FILE = path.join(config.paths.workspace, 'token-usage.json')
const FRANK_CHAT_ID = '17034981581@s.whatsapp.net'

// Pricing per million tokens (as of March 2026)
const PRICING = {
  'haiku': { input: 1.00, output: 5.00 },
  'sonnet': { input: 3.00, output: 15.00 },
  'opus': { input: 15.00, output: 75.00 },
}

const DAILY_ALERT_THRESHOLD = 10.00   // $10 alert
const DAILY_CIRCUIT_BREAKER = 25.00   // $25 force Haiku-only

function getModelTier(modelName) {
  if (!modelName) return 'sonnet'
  const lower = modelName.toLowerCase()
  if (lower.includes('haiku')) return 'haiku'
  if (lower.includes('opus')) return 'opus'
  return 'sonnet'
}

function getToday() {
  return new Date().toISOString().split('T')[0]
}

function loadUsage() {
  try {
    if (fs.existsSync(USAGE_FILE)) {
      return JSON.parse(fs.readFileSync(USAGE_FILE, 'utf-8'))
    }
  } catch (err) {
    console.error('[TokenMonitor] Failed to load usage:', err.message)
  }
  return { days: {}, totalCost: 0 }
}

function saveUsage(data) {
  try {
    const dir = path.dirname(USAGE_FILE)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(USAGE_FILE, JSON.stringify(data, null, 2))
  } catch (err) {
    console.error('[TokenMonitor] Failed to save usage:', err.message)
  }
}

function ensureDayEntry(data, date) {
  if (!data.days[date]) {
    data.days[date] = {
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
      messageCount: 0,
      byModel: {},
      alertSent: false,
      circuitBreakerTripped: false
    }
  }
  return data.days[date]
}

function calculateCost(inputTokens, outputTokens, modelTier) {
  const pricing = PRICING[modelTier] || PRICING.sonnet
  const inputCost = (inputTokens / 1_000_000) * pricing.input
  const outputCost = (outputTokens / 1_000_000) * pricing.output
  return inputCost + outputCost
}

/**
 * Record token usage for a message
 */
function recordUsage(inputTokens, outputTokens, modelName) {
  const modelTier = getModelTier(modelName)
  const cost = calculateCost(inputTokens, outputTokens, modelTier)
  const today = getToday()

  const data = loadUsage()
  const day = ensureDayEntry(data, today)

  day.inputTokens += inputTokens
  day.outputTokens += outputTokens
  day.cost += cost
  day.messageCount++

  if (!day.byModel[modelTier]) {
    day.byModel[modelTier] = { inputTokens: 0, outputTokens: 0, cost: 0, count: 0 }
  }
  day.byModel[modelTier].inputTokens += inputTokens
  day.byModel[modelTier].outputTokens += outputTokens
  day.byModel[modelTier].cost += cost
  day.byModel[modelTier].count++

  data.totalCost = Object.values(data.days).reduce((sum, d) => sum + d.cost, 0)

  saveUsage(data)

  return { cost, dailyTotal: day.cost, modelTier }
}

/**
 * Check if circuit breaker should be tripped
 */
function isDailyLimitExceeded() {
  const data = loadUsage()
  const day = data.days[getToday()]
  if (!day) return false
  return day.cost >= DAILY_CIRCUIT_BREAKER
}

/**
 * Get today's usage summary
 */
function getTodayUsage() {
  const data = loadUsage()
  const day = data.days[getToday()]
  if (!day) return { cost: 0, messageCount: 0, inputTokens: 0, outputTokens: 0 }
  return day
}

/**
 * Format usage for display
 */
function formatUsage(days = 7) {
  const data = loadUsage()
  const dates = Object.keys(data.days).sort().reverse().slice(0, days)

  if (!dates.length) return 'No token usage recorded yet.'

  const lines = ['Token Usage Report', '']

  for (const date of dates) {
    const day = data.days[date]
    lines.push(`${date}: $${day.cost.toFixed(2)} | ${day.messageCount} msgs | ${(day.inputTokens / 1000).toFixed(1)}K in / ${(day.outputTokens / 1000).toFixed(1)}K out`)

    if (day.byModel) {
      for (const [model, stats] of Object.entries(day.byModel)) {
        lines.push(`  ${model}: $${stats.cost.toFixed(2)} (${stats.count} msgs)`)
      }
    }
  }

  lines.push('')
  lines.push(`Total all-time: $${data.totalCost.toFixed(2)}`)

  return lines.join('\n')
}

export function register(gateway) {
  // Store reference for circuit breaker access
  gateway._tokenMonitor = {
    recordUsage,
    isDailyLimitExceeded,
    getTodayUsage,
    formatUsage,
    DAILY_ALERT_THRESHOLD,
    DAILY_CIRCUIT_BREAKER
  }

  // Hook into agent completion to track tokens
  gateway.agentRunner.on('completed', async ({ runId, processingTimeMs, usage }) => {
    // usage comes from the provider if available
    if (usage && usage.inputTokens && usage.outputTokens) {
      const modelName = gateway.agentRunner.agent.provider.currentModel || process.env.CLAUDE_MODEL
      const result = recordUsage(usage.inputTokens, usage.outputTokens, modelName)

      console.log(`[TokenMonitor] Message cost: $${result.cost.toFixed(4)} | Daily: $${result.dailyTotal.toFixed(2)} (${result.modelTier})`)

      // Check alert threshold
      const data = loadUsage()
      const day = data.days[getToday()]

      if (day && day.cost >= DAILY_ALERT_THRESHOLD && !day.alertSent) {
        day.alertSent = true
        saveUsage(data)

        // Send alert to Frank
        try {
          const adapter = gateway.adapters?.get('whatsapp') || gateway.adapter
          if (adapter) {
            await adapter.sendMessage(FRANK_CHAT_ID,
              `Token budget alert: $${day.cost.toFixed(2)} spent today (${day.messageCount} messages). ` +
              `Threshold: $${DAILY_ALERT_THRESHOLD}. Circuit breaker at $${DAILY_CIRCUIT_BREAKER}.`
            )
          }
        } catch (err) {
          console.error('[TokenMonitor] Failed to send alert:', err.message)
        }
      }

      // Circuit breaker
      if (day && day.cost >= DAILY_CIRCUIT_BREAKER && !day.circuitBreakerTripped) {
        day.circuitBreakerTripped = true
        saveUsage(data)
        console.warn(`[TokenMonitor] CIRCUIT BREAKER TRIPPED — forcing Haiku-only mode`)

        // Force Haiku mode by overriding the model router
        const provider = gateway.agentRunner.agent.provider
        provider.setModel('claude-haiku-4-5-20251001')

        try {
          const adapter = gateway.adapters?.get('whatsapp') || gateway.adapter
          if (adapter) {
            await adapter.sendMessage(FRANK_CHAT_ID,
              `CIRCUIT BREAKER: $${day.cost.toFixed(2)} spent today. Switching to Haiku-only mode until midnight.`
            )
          }
        } catch (err) {
          console.error('[TokenMonitor] Failed to send circuit breaker alert:', err.message)
        }
      }
    }
  })

  // Register /tokens command
  const originalExecute = gateway.commandHandler.execute.bind(gateway.commandHandler)
  gateway.commandHandler.execute = async function (text, sessionKey, adapter, chatId) {
    const cmd = text.trim().toLowerCase()
    if (cmd === '/tokens' || cmd === '/cost' || cmd === '/usage') {
      return { handled: true, response: formatUsage() }
    }
    return originalExecute(text, sessionKey, adapter, chatId)
  }

  console.log('[TokenMonitor] Cost tracking enabled ($10 alert, $25 circuit breaker)')
}
