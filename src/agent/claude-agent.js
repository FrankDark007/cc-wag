import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'
import MemoryManager from '../memory/manager.js'
import { createCronMcpServer, setContext as setCronContext, getScheduler } from '../tools/cron.js'
import { createGatewayMcpServer, setGatewayContext } from '../tools/gateway-mcp.js'
import { ClaudeProvider } from '../providers/claude-provider.js'
import { asyncContext } from '../utils/async-context.js'
import config from '../config.js'

const SYSTEM_PROMPT_PATH = config.paths.systemPrompt

// Prompt template cache — avoids re-reading files on every message
const promptCache = { template: null, initialized: false }

function initPromptCache() {
  if (promptCache.initialized) return
  promptCache.template = loadSystemPromptTemplate()
  promptCache.initialized = true

  // Watch for changes with 5s polling interval
  try {
    fs.watchFile(SYSTEM_PROMPT_PATH, { interval: 5000 }, () => {
      console.log('[Agent] System prompt template changed — reloading')
      promptCache.template = loadSystemPromptTemplate()
    })
  } catch (err) {
    console.error('[Agent] File watcher failed:', err.message)
  }
}

/**
 * Load the system prompt from config/system-prompt.md
 */
function loadSystemPromptTemplate() {
  try {
    if (fs.existsSync(SYSTEM_PROMPT_PATH)) {
      return fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf-8')
    }
  } catch (err) {
    console.error('[Agent] Failed to load system prompt template:', err.message)
  }
  return null
}

// Model tier constants for tiered prompts
const MODEL_TIER = {
  HAIKU: 'haiku',
  SONNET: 'sonnet',
  OPUS: 'opus'
}

/**
 * Detect model tier from the current model string
 */
function getModelTier(modelName) {
  if (!modelName) return MODEL_TIER.SONNET
  const lower = modelName.toLowerCase()
  if (lower.includes('haiku')) return MODEL_TIER.HAIKU
  if (lower.includes('opus')) return MODEL_TIER.OPUS
  return MODEL_TIER.SONNET
}

/**
 * Build the system prompt with tiered complexity based on model.
 *
 * Haiku tier:  identity + date/time + style (~500 chars)
 * Sonnet tier: core prompt without memory dump (~3KB)
 * Opus tier:   full prompt with memory + observations (~8KB max)
 *
 * CLAUDE.md (Frank's personal CC workflow) is NEVER injected — irrelevant to Atlas.
 * system-prompt.md is the SOLE template (no hardcoded duplication).
 */
function buildSystemPrompt(memoryContext, sessionInfo, cronInfo, observationContext, modelTier) {
  const now = new Date()
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
  const timeStr = now.toLocaleTimeString('en-US', { hour12: true })

  initPromptCache()
  const template = promptCache.template

  // ── Haiku tier: minimal prompt for greetings/commands ──
  if (modelTier === MODEL_TIER.HAIKU) {
    return `You are Atlas, Frank's AI assistant via WhatsApp. Keep responses short and casual.
Date: ${dateStr}, ${timeStr}
Style: Plain text only, no markdown. Under 200 chars for greetings.`
  }

  // ── Sonnet tier: core prompt without memory dump ──
  const corePrompt = `You are Atlas, Frank Darakhshan's AI executive assistant via WhatsApp. Frank is President of Flood Doctor LLC, a water damage restoration company in Northern Virginia.

Business: Flood Doctor LLC | 8466D Tyco Rd, Vienna, VA 22182 | (877) 497-0007 | DPOR #2705155505 | flood.doctor

Date: ${dateStr} | Time: ${timeStr} | Session: ${sessionInfo.sessionKey} | Platform: ${sessionInfo.platform}

Style: WhatsApp mobile-friendly, plain text only (no markdown), under 500 chars unless detail requested.

Workspace: ${config.paths.workspace}/
Observations file: ${config.paths.observationsFile}
Observation domains: client, insurance, crew, scheduling, preference, business, project, contact

Google Tasks (gws CLI): FloodDoctor list=WUlnZzdORlJwa01PTEFVSw | Personal list=NE1SZ0pXUF9hT2pVczFUQg

Cron tools: schedule_delayed, schedule_recurring, schedule_cron, list_scheduled, cancel_scheduled
${cronInfo ? '\nScheduled jobs:\n' + cronInfo : ''}

Gateway tools: send_whatsapp, send_message, list_platforms, get_queue_status, get_current_context, list_sessions, broadcast_message

Group chats: limited permissions, no financial data to team. Frank DMs: full access.`

  if (modelTier === MODEL_TIER.SONNET) {
    // Sonnet gets core + template (no memory context, no observations)
    return template
      ? corePrompt + '\n\n' + template
      : corePrompt
  }

  // ── Opus tier: full prompt with memory + observations ──
  const parts = [corePrompt]

  if (memoryContext) {
    parts.push('## Memory Context\n' + memoryContext)
  }

  if (observationContext) {
    parts.push(observationContext)
  }

  if (template) {
    parts.push(template)
  }

  return parts.join('\n\n')
}

/**
 * Claude Agent using the Claude Agent SDK
 * With memory system and cron MCP server
 */
export default class ClaudeAgent extends EventEmitter {
  constructor(config = {}) {
    super()
    this.memoryManager = new MemoryManager()
    this.cronMcpServer = createCronMcpServer()
    this.cronScheduler = getScheduler()
    this.gatewayMcpServer = createGatewayMcpServer()
    this.gateway = null // Set by gateway after construction
    this.sessions = new Map()
    this.abortControllers = new Map()

    // Provider setup - Claude only
    this.providerName = 'claude'
    const providerConfig = {
      allowedTools: config.allowedTools,
      maxTurns: config.maxTurns,
      permissionMode: config.permissionMode,
    }
    this.provider = new ClaudeProvider(providerConfig)

    this.allowedTools = config.allowedTools || [
      'Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep',
      'TodoWrite', 'Skill', 'AskUserQuestion'
    ]

    // Add cron MCP tools to allowed list
    this.cronTools = [
      'mcp__cron__schedule_delayed',
      'mcp__cron__schedule_recurring',
      'mcp__cron__schedule_cron',
      'mcp__cron__list_scheduled',
      'mcp__cron__cancel_scheduled'
    ]

    // Add gateway MCP tools to allowed list
    this.gatewayTools = [
      'mcp__gateway__send_whatsapp',
      'mcp__gateway__send_message',
      'mcp__gateway__list_platforms',
      'mcp__gateway__get_queue_status',
      'mcp__gateway__get_current_context',
      'mcp__gateway__list_sessions',
      'mcp__gateway__broadcast_message'
    ]

    this.maxTurns = config.maxTurns || 50
    this.permissionMode = config.permissionMode || 'default'

    // Forward cron events
    this.cronScheduler.on('execute', (data) => this.emit('cron:execute', data))
  }

  getSession(sessionKey) {
    if (!this.sessions.has(sessionKey)) {
      this.sessions.set(sessionKey, {
        sdkSessionId: null,
        createdAt: Date.now(),
        lastActivity: Date.now(),
        messageCount: 0
      })
    }
    return this.sessions.get(sessionKey)
  }

  abort(sessionKey) {
    return this.provider.abort(sessionKey)
  }

  getCronSummary() {
    const jobs = this.cronScheduler.list()
    if (jobs.length === 0) return null
    return jobs.map(j => `- ${j.id}: ${j.description} (${j.type})`).join('\n')
  }

  /**
   * Build prompt - supports images for vision
   */
  buildPrompt(message, image) {
    if (!image) return message

    return [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: image.mediaType,
          data: image.data
        }
      },
      {
        type: 'text',
        text: message
      }
    ]
  }

  /**
   * Generate streaming messages for the SDK
   */
  async *generateMessages(message, image) {
    yield {
      type: 'user',
      message: {
        role: 'user',
        content: this.buildPrompt(message, image)
      }
    }
  }

  /**
   * Run the agent for a message
   */
  async *run(params) {
    const {
      message,
      sessionKey,
      platform = 'unknown',
      chatId = null,
      image = null,
      mcpServers = {},
      canUseTool
    } = params

    // Store per-request context for async-safe access
    asyncContext.enterWith({ platform, chatId, sessionKey, gateway: this.gateway })

    const session = this.getSession(sessionKey)
    session.lastActivity = Date.now()
    session.messageCount++

    // Set cron context for scheduled messages
    setCronContext({ platform, chatId, sessionKey })

    // Set gateway context
    setGatewayContext({
      gateway: this.gateway,
      currentPlatform: platform,
      currentChatId: chatId,
      currentSessionKey: sessionKey
    })

    // Determine model tier for tiered system prompt
    const currentModel = this.provider.currentModel || process.env.CLAUDE_MODEL || ''
    const modelTier = getModelTier(currentModel)

    // Build system prompt — tiered by model complexity
    // Haiku: minimal (~500 chars), Sonnet: core (~3KB), Opus: full with memory (~8KB)
    const memoryContext = modelTier === MODEL_TIER.HAIKU ? null : this.memoryManager.getMemoryContext()
    const cronInfo = modelTier === MODEL_TIER.HAIKU ? null : this.getCronSummary()
    const observationContext = modelTier === MODEL_TIER.OPUS ? this.memoryManager.getObservationContext(message) : null
    const systemPrompt = buildSystemPrompt(memoryContext, { sessionKey, platform }, cronInfo, observationContext, modelTier)

    console.log(`[Agent] System prompt: ${systemPrompt.length} chars (${modelTier} tier)`)

    // Combine all allowed tools
    const allAllowedTools = [...this.allowedTools, ...this.cronTools, ...this.gatewayTools]

    const allMcpServers = {
      cron: this.cronMcpServer,
      gateway: this.gatewayMcpServer,
      ...mcpServers
    }

    if (image) console.log('[ClaudeAgent] With image attachment')

    this.emit('run:start', { sessionKey, message, hasImage: !!image })

    try {
      let fullText = ''
      let hasStreamedContent = false

      const queryParams = {
        prompt: this.generateMessages(message, image),
        chatId: sessionKey,
        mcpServers: allMcpServers,
        allowedTools: allAllowedTools,
        maxTurns: this.maxTurns,
        systemPrompt,
        permissionMode: this.permissionMode
      }
      if (canUseTool) {
        queryParams.canUseTool = canUseTool
      }
      for await (const chunk of this.provider.query(queryParams)) {
        // Handle streaming partial messages (token-level streaming)
        if (chunk.type === 'stream_event' && chunk.event) {
          const event = chunk.event
          hasStreamedContent = true

          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            const text = event.delta.text
            if (text) {
              fullText += text
              yield { type: 'text', content: text, isReasoning: !!event.isReasoning }
              this.emit('run:text', { sessionKey, content: text })
            }
          } else if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
            yield {
              type: 'tool_use',
              name: event.content_block.name,
              input: event.content_block.input || {},
              id: event.content_block.id
            }
            this.emit('run:tool', { sessionKey, name: event.content_block.name })
          }
          continue
        }

        // Handle complete assistant messages (only if we haven't streamed content)
        if (chunk.type === 'assistant' && chunk.message?.content) {
          for (const block of chunk.message.content) {
            if (block.type === 'text' && block.text && !hasStreamedContent) {
              fullText += block.text
              yield { type: 'text', content: block.text }
              this.emit('run:text', { sessionKey, content: block.text })
            } else if (block.type === 'tool_use') {
              if (!hasStreamedContent) {
                yield { type: 'tool_use', name: block.name, input: block.input, id: block.id }
                this.emit('run:tool', { sessionKey, name: block.name })
              }
            }
          }
          continue
        }

        // Handle tool results
        if (chunk.type === 'tool_result' || chunk.type === 'result') {
          yield { type: 'tool_result', result: chunk.result || chunk.content }
          continue
        }

        // Handle done/aborted/error from provider
        if (chunk.type === 'done') {
          break
        }
        if (chunk.type === 'aborted') {
          yield { type: 'aborted' }
          this.emit('run:aborted', { sessionKey })
          return
        }
        if (chunk.type === 'error') {
          yield { type: 'error', error: chunk.error }
          this.emit('run:error', { sessionKey, error: chunk.error })
          return
        }

        if (chunk.type !== 'system') {
          yield chunk
        }
      }

      yield { type: 'done', fullText }
      this.emit('run:complete', { sessionKey, response: fullText })

    } catch (error) {
      if (error.name === 'AbortError') {
        yield { type: 'aborted' }
        this.emit('run:aborted', { sessionKey })
      } else {
        console.error('[ClaudeAgent] Error:', error)
        yield { type: 'error', error: error.message }
        this.emit('run:error', { sessionKey, error })
        throw error
      }
    }
  }

  /**
   * Run and collect full response
   */
  async runAndCollect(params) {
    let fullText = ''
    for await (const chunk of this.run(params)) {
      if (chunk.type === 'text') {
        fullText += chunk.content
      }
      if (chunk.type === 'done') {
        return chunk.fullText || fullText
      }
      if (chunk.type === 'error') {
        throw new Error(chunk.error)
      }
    }
    return fullText
  }

  stopCron() {
    this.cronScheduler.stop()
  }
}
