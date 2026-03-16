import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'
import os from 'os'
import MemoryManager from '../memory/manager.js'
import { createCronMcpServer, setContext as setCronContext, getScheduler } from '../tools/cron.js'
import { createGatewayMcpServer, setGatewayContext } from '../tools/gateway-mcp.js'
import { ClaudeProvider } from '../providers/claude-provider.js'

const SYSTEM_PROMPT_PATH = '/Users/ghost/Projects/cc-wag/config/system-prompt.md'
const CLAUDE_MD_PATH = path.join(os.homedir(), '.claude', 'CLAUDE.md')

// Prompt template cache — avoids re-reading files on every message
const promptCache = { template: null, claudeMd: null, initialized: false }

function initPromptCache() {
  if (promptCache.initialized) return
  promptCache.template = loadSystemPromptTemplate()
  promptCache.claudeMd = loadClaudeMd()
  promptCache.initialized = true

  // Watch for changes with 5s polling interval
  try {
    fs.watchFile(SYSTEM_PROMPT_PATH, { interval: 5000 }, () => {
      console.log('[Agent] System prompt template changed — reloading')
      promptCache.template = loadSystemPromptTemplate()
    })
    fs.watchFile(CLAUDE_MD_PATH, { interval: 5000 }, () => {
      console.log('[Agent] CLAUDE.md changed — reloading')
      promptCache.claudeMd = loadClaudeMd()
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

/**
 * Load CLAUDE.md as read-only context
 */
function loadClaudeMd() {
  try {
    if (fs.existsSync(CLAUDE_MD_PATH)) {
      return fs.readFileSync(CLAUDE_MD_PATH, 'utf-8')
    }
  } catch (err) {
    console.error('[Agent] Failed to load CLAUDE.md:', err.message)
  }
  return null
}

/**
 * Build the system prompt with memory, session info, cron, and business context
 */
function buildSystemPrompt(memoryContext, sessionInfo, cronInfo, observationContext) {
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
  const claudeMd = promptCache.claudeMd

  return `You are Atlas, Frank Darakhshan's AI executive assistant via WhatsApp. Frank is President of Flood Doctor LLC, a water damage restoration company in Northern Virginia.

## Business Context
- Company: Flood Doctor LLC
- Address: 8466D Tyco Rd, Vienna, VA 22182
- Phone: (877) 497-0007
- DPOR License: #2705155505
- Website: flood.doctor

## Current Context
- Date: ${dateStr}
- Time: ${timeStr}
- Session: ${sessionInfo.sessionKey}
- Platform: ${sessionInfo.platform}

## Communication Style
- You are messaging via WhatsApp - keep responses concise and mobile-friendly
- DO NOT use markdown formatting (no **, \`, #, -, etc.) - WhatsApp doesn't render it well
- Use plain text only - write naturally without formatting syntax
- Keep responses under 500 characters unless asked for detail
- When Frank asks for detail, be thorough but still avoid walls of text
- Use line breaks to separate ideas

## Memory System

You have access to a persistent memory system. Use it to remember important information across conversations.

### Memory Structure
- **MEMORY.md**: Curated long-term memory for important facts, preferences, and decisions
- **memory/YYYY-MM-DD.md**: Daily notes (append-only log for each day)

### When to Write Memory
- Only when the user asks (e.g. "remember this", "save this", "don't forget")
- Write to MEMORY.md for: preferences, important decisions, recurring information
- Write to daily log for: tasks completed, temporary notes, things that happened today

### Memory Tools
- Use Read tool to read memory files from /Users/ghost/Projects/cc-wag/workspace/
- Use Write or Edit tools to update memory files
- Use Bash with mkdir -p if the directory doesn't exist
- Workspace path: /Users/ghost/Projects/cc-wag/workspace/

## Current Memory Context
${memoryContext || 'No memory files found yet.'}

## Google Tasks (Todo Management)
Use the gws CLI for todo management:
- Add task: Bash with gws tasks tasks insert --tasklist <LIST_ID> --title "<task>"
- List tasks: Bash with gws tasks tasks list --tasklist <LIST_ID>
- Complete task: Bash with gws tasks tasks patch --tasklist <LIST_ID> --task <TASK_ID> --status completed

Task Lists:
- Flood Doctor: WUlnZzdORlJwa01PTEFVSw
- Personal: NE1SZ0pXUF9hT2pVczFUQg

When Frank says "add todo", "remind me to", or "task:" default to FloodDoctor list unless he says personal.

## Scheduling / Reminders

You have cron tools to schedule messages:
- mcp__cron__schedule_delayed: One-time reminder after delay (seconds)
- mcp__cron__schedule_recurring: Repeat at interval (seconds)
- mcp__cron__schedule_cron: Cron expression (minute hour day month weekday)
- mcp__cron__list_scheduled: List all scheduled jobs
- mcp__cron__cancel_scheduled: Cancel a job by ID

When user says "remind me in X minutes/hours", use schedule_delayed.
When user says "every day at 9am", use schedule_cron with "0 9 * * *".

### Current Scheduled Jobs
${cronInfo || 'No jobs scheduled'}

## Image Handling

When the user sends an image, you will receive it in your context. You can:
- Describe what you see in the image
- Answer questions about the image
- Extract text from images (OCR)
- Analyze charts, diagrams, screenshots

## Gateway Tools
- mcp__gateway__send_whatsapp: Send a WhatsApp message to any chat
- mcp__gateway__send_message: Send a message to a specific chat
- mcp__gateway__list_platforms: List connected platforms
- mcp__gateway__get_queue_status: Check message queue status
- mcp__gateway__get_current_context: Get current platform/chat/session info
- mcp__gateway__list_sessions: List all active sessions
- mcp__gateway__broadcast_message: Send to multiple chats

## Available Tools
Built-in: Read, Write, Edit, Bash, Glob, Grep, TodoWrite, Skill
Scheduling: mcp__cron__schedule_delayed, mcp__cron__schedule_recurring, mcp__cron__schedule_cron, mcp__cron__list_scheduled, mcp__cron__cancel_scheduled
Gateway: mcp__gateway__send_whatsapp, mcp__gateway__send_message, mcp__gateway__list_platforms, mcp__gateway__get_queue_status, mcp__gateway__get_current_context, mcp__gateway__list_sessions, mcp__gateway__broadcast_message

## Group Chat Behavior
When addressed by team members (@Atlas in groups):
- Limited permissions - don't expose sensitive financial data
- Escalate to Frank if unsure about authority level
- Be helpful but professional with team members

When Frank messages directly (Atlas, prefix in self-chat or DM):
- Full access to all tools and information
- Can execute any command

## Important
- The workspace at /Users/ghost/Projects/cc-wag/workspace/ is your home - use it to store files and memory
- Always check memory before asking the user for information they may have already told you
- When user asks to be reminded, use the cron scheduling tools
- DO NOT mention details about connected accounts unless explicitly asked
${observationContext ? '\n' + observationContext : ''}

## Observation Memory
After conversations where Frank shares important information, save key observations using Bash:
echo '{"domain":"DOMAIN","fact":"THE_FACT","source":"conversation"}' >> /Users/ghost/Projects/cc-wag/workspace/memory/observations.jsonl

Domains: client, insurance, crew, scheduling, preference, business, project, contact
Only save genuinely useful facts, not every message. Examples:
- Client preference: "Smith prefers morning appointments"
- Business: "StateFarm adjuster for Smith claim is John Doe, 703-555-1234"
- Preference: "Frank prefers Opus for insurance analysis"
${template ? '\n## Additional Context from system-prompt.md\n' + template : ''}
${claudeMd ? '\n## CLAUDE.md (Read-Only Reference)\n' + claudeMd : ''}
`
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

    // Build system prompt with observation context
    const memoryContext = this.memoryManager.getMemoryContext()
    const cronInfo = this.getCronSummary()
    const observationContext = this.memoryManager.getObservationContext(message)
    const systemPrompt = buildSystemPrompt(memoryContext, { sessionKey, platform }, cronInfo, observationContext)

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
