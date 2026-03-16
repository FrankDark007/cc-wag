import { execSync } from 'child_process'

/**
 * Slash command handler for CC-WAG
 * Processes commands like /new, /reset, /status, /memory, /model, /queue, /help, /stop, /todo
 */
export default class CommandHandler {
  constructor(gateway) {
    this.gateway = gateway
    this.pendingModelSelect = new Map() // chatId -> resolve
  }

  /**
   * Check if message is a command
   */
  isCommand(text) {
    return text.trim().startsWith('/')
  }

  /**
   * Parse command and arguments
   */
  parse(text) {
    const trimmed = text.trim()
    const spaceIndex = trimmed.indexOf(' ')
    if (spaceIndex === -1) {
      return { command: trimmed.slice(1).toLowerCase(), args: '' }
    }
    return {
      command: trimmed.slice(1, spaceIndex).toLowerCase(),
      args: trimmed.slice(spaceIndex + 1).trim()
    }
  }

  /**
   * Execute a command
   * @returns {Object} { handled: boolean, response?: string }
   */
  async execute(text, sessionKey, adapter, chatId) {
    if (!this.isCommand(text)) {
      return { handled: false }
    }

    const { command, args } = this.parse(text)

    switch (command) {
      case 'new':
      case 'reset':
        return this.handleReset(sessionKey, adapter, chatId)

      case 'status':
        return this.handleStatus(sessionKey)

      case 'memory':
        return this.handleMemory(args)

      case 'queue':
        return this.handleQueue()

      case 'help':
        return this.handleHelp()

      case 'stop':
        return this.handleStop(sessionKey)

      case 'model':
        return this.handleModel(args, chatId, adapter)

      case 'todo':
        return this.handleTodo(args)

      case 'whereisfrank':
        return this.handleWhereIsFrank(adapter, chatId)

      default:
        // Unknown command, pass to agent
        return { handled: false }
    }
  }

  /**
   * Check if a message is a reply to a pending /model selection
   */
  handlePendingReply(text, chatId) {
    if (this.pendingModelSelect.has(chatId)) {
      const resolve = this.pendingModelSelect.get(chatId)
      this.pendingModelSelect.delete(chatId)
      resolve(text.trim())
      return true
    }
    return false
  }

  async handleReset(sessionKey, adapter, chatId) {
    const sessionManager = this.gateway.sessionManager
    const agentRunner = this.gateway.agentRunner

    if (agentRunner.agent.sessions.has(sessionKey)) {
      agentRunner.agent.sessions.delete(sessionKey)
    }

    if (sessionManager.sessions.has(sessionKey)) {
      sessionManager.sessions.delete(sessionKey)
    }

    return {
      handled: true,
      response: 'Session reset. Starting fresh.'
    }
  }

  handleStatus(sessionKey) {
    const sessionManager = this.gateway.sessionManager
    const agentRunner = this.gateway.agentRunner

    const agentSession = agentRunner.agent.sessions.get(sessionKey)
    const queueStatus = agentRunner.getQueueStatus(sessionKey)
    const globalStats = agentRunner.getGlobalStats()

    const lines = [
      'Status',
      '',
      `Session: ${sessionKey.split(':').slice(-2).join(':')}`,
      `Messages: ${agentSession?.messageCount || 0}`,
      `Queue: ${queueStatus.pending} pending${queueStatus.processing ? ' (processing)' : ''}`,
      '',
      `Global: ${globalStats.totalProcessed} processed, ${globalStats.totalFailed} failed`
    ]

    return {
      handled: true,
      response: lines.join('\n')
    }
  }

  handleMemory(args) {
    const memoryManager = this.gateway.agentRunner.agent.memoryManager

    if (args === 'list') {
      const files = memoryManager.listDailyFiles()
      const lines = [
        'Memory Files',
        '',
        `MEMORY.md: ${memoryManager.readLongTermMemory() ? 'exists' : 'empty'}`,
        '',
        'Daily logs:',
        ...files.slice(0, 10).map(f => `  ${f}`)
      ]
      if (files.length > 10) {
        lines.push(`  ... and ${files.length - 10} more`)
      }
      return { handled: true, response: lines.join('\n') }
    }

    if (args.startsWith('search ')) {
      const query = args.slice(7)
      const results = memoryManager.searchMemory(query)
      if (results.length === 0) {
        return { handled: true, response: `No results for "${query}"` }
      }
      const lines = [
        `Search: "${query}"`,
        ''
      ]
      for (const result of results.slice(0, 5)) {
        lines.push(`${result.file}:`)
        for (const match of result.matches.slice(0, 2)) {
          lines.push(`  Line ${match.line}: ${match.context.substring(0, 100)}...`)
        }
      }
      return { handled: true, response: lines.join('\n') }
    }

    // Show today's memory
    const today = memoryManager.readTodayMemory()
    const longTerm = memoryManager.readLongTermMemory()

    const lines = [
      'Memory',
      '',
      'Long-term (MEMORY.md):',
      longTerm ? longTerm.substring(0, 500) + (longTerm.length > 500 ? '...' : '') : 'Empty',
      '',
      'Today:',
      today ? today.substring(0, 500) + (today.length > 500 ? '...' : '') : 'No notes yet'
    ]

    return {
      handled: true,
      response: lines.join('\n')
    }
  }

  handleQueue() {
    const stats = this.gateway.agentRunner.getGlobalStats()

    const lines = [
      'Queue Status',
      '',
      `Pending: ${stats.totalPending}`,
      `Active sessions: ${stats.activeSessions}`,
      `Total sessions: ${stats.totalSessions}`,
      '',
      `Processed: ${stats.totalProcessed}`,
      `Failed: ${stats.totalFailed}`
    ]

    return {
      handled: true,
      response: lines.join('\n')
    }
  }

  handleStop(sessionKey) {
    const aborted = this.gateway.agentRunner.abort(sessionKey)
    return {
      handled: true,
      response: aborted ? 'Stopped current operation' : 'Nothing to stop'
    }
  }

  async handleModel(args, chatId, adapter) {
    const agent = this.gateway.agentRunner.agent
    const provider = agent.provider
    const models = provider.getAvailableModels()
    const current = provider.getModel()

    // If arg provided directly, e.g. /model 2
    if (args) {
      const idx = parseInt(args) - 1
      if (idx >= 0 && idx < models.length) {
        provider.setModel(models[idx].id)
        return { handled: true, response: `Model set to: ${models[idx].label} (${models[idx].id})` }
      }
      const match = models.find(m => m.id.includes(args.toLowerCase()) || m.label.toLowerCase().includes(args.toLowerCase()))
      if (match) {
        provider.setModel(match.id)
        return { handled: true, response: `Model set to: ${match.label} (${match.id})` }
      }
      return { handled: true, response: `Unknown model. Use /model to see options.` }
    }

    // Show list and wait for reply
    const lines = [
      `Models (claude)`,
      `Current: ${current || '(default)'}`,
      ''
    ]
    for (let i = 0; i < models.length; i++) {
      const marker = models[i].id === current ? ' <-' : ''
      lines.push(`${i + 1}) ${models[i].label}${marker}`)
    }
    lines.push('', 'Reply with a number to switch.')

    await adapter.sendMessage(chatId, lines.join('\n'))

    // Wait for reply with timeout
    const reply = await new Promise((resolve) => {
      this.pendingModelSelect.set(chatId, resolve)
      setTimeout(() => {
        if (this.pendingModelSelect.has(chatId)) {
          this.pendingModelSelect.delete(chatId)
          resolve(null)
        }
      }, 30000)
    })

    if (!reply) return { handled: true, response: '' }

    const idx = parseInt(reply) - 1
    if (idx >= 0 && idx < models.length) {
      provider.setModel(models[idx].id)
      return { handled: true, response: `Model set to: ${models[idx].label}` }
    }
    return { handled: true, response: 'No change.' }
  }

  /**
   * Handle /todo command - adds a task to Google Tasks via gws CLI
   * Usage: /todo <task text>
   * Usage: /todo personal <task text>
   */
  handleTodo(args) {
    if (!args) {
      return {
        handled: true,
        response: 'Usage: /todo <task>\n/todo personal <task>'
      }
    }

    let listId = 'WUlnZzdORlJwa01PTEFVSw' // FloodDoctor default
    let taskTitle = args

    // Check if first word is "personal"
    if (args.toLowerCase().startsWith('personal ')) {
      listId = 'NE1SZ0pXUF9hT2pVczFUQg' // Personal
      taskTitle = args.slice(9).trim()
    }

    try {
      const escaped = taskTitle.replace(/"/g, '\\"')
      execSync(`/opt/homebrew/bin/gws tasks tasks insert --tasklist "${listId}" --title "${escaped}"`, {
        encoding: 'utf-8',
        timeout: 10000
      })
      const listName = listId === 'NE1SZ0pXUF9hT2pVczFUQg' ? 'Personal' : 'FloodDoctor'
      return {
        handled: true,
        response: `Added to ${listName}: ${taskTitle}`
      }
    } catch (err) {
      return {
        handled: true,
        response: `Failed to add task: ${err.message}`
      }
    }
  }

  /**
   * Handle /whereisfrank - request Frank's live location from his phone
   * On-demand: pushes to Tasker via Join, waits for GPS response, sends WhatsApp pin
   */
  async handleWhereIsFrank(adapter, chatId) {
    const gateway = this.gateway

    // Send immediate acknowledgment
    await adapter.sendMessage(chatId, '🔱 *Atlas:* Locating Frank... requesting GPS from his phone.')

    const result = await gateway.requestLocation()

    if (result.error) {
      return {
        handled: true,
        response: `🔱 *Atlas:* Could not get Frank's location: ${result.error}`
      }
    }

    // Send the location as a WhatsApp map pin
    try {
      await adapter.sendLocation(
        chatId,
        result.lat,
        result.lng,
        "Frank's Location",
        result.accuracy ? `Accuracy: ~${Math.round(result.accuracy)}m` : ''
      )

      const mins = Math.round((Date.now() - result.timestamp) / 60000)
      return {
        handled: true,
        response: `🔱 *Atlas:* Location pinned above.${result.accuracy ? ` Accuracy: ~${Math.round(result.accuracy)}m.` : ''} Retrieved just now.`
      }
    } catch (err) {
      return {
        handled: true,
        response: `🔱 *Atlas:* Got coordinates (${result.lat}, ${result.lng}) but failed to send map pin: ${err.message}`
      }
    }
  }

  handleHelp() {
    const lines = [
      'CC-WAG Commands',
      '',
      '/new or /reset - Start fresh session',
      '/status - Show session status',
      '/memory - Show memory summary',
      '/memory list - List memory files',
      '/memory search <query> - Search memories',
      '/queue - Show queue status',
      '/model - Switch AI model',
      '/model 2 - Switch to model by number',
      '/todo <task> - Add to FloodDoctor tasks',
      '/todo personal <task> - Add to Personal tasks',
      '/whereisfrank - Get Frank\'s live GPS location',
      '/stop - Stop current operation',
      '/help - Show this help'
    ]

    return {
      handled: true,
      response: lines.join('\n')
    }
  }
}
