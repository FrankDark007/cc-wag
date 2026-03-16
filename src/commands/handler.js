import { execSync, execFileSync } from 'child_process'
import fs from 'fs'
import config from '../config.js'

/**
 * Slash command handler for Atlas
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

      case 'todos':
        return this.handleTodos(args)

      case 'whereisfrank':
        return this.handleWhereIsFrank(adapter, chatId)

      case 'inbox':
        return this.handleInbox(args)

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
  /**
   * Parse natural language task input for priority, due date, and category
   * Examples:
   *   "urgent: call adjuster about Smith claim by tomorrow"
   *   "personal high: dentist appointment friday"
   *   "/todo follow up with StateFarm !high @insurance by 3/20"
   */
  parseTodoInput(args) {
    let text = args
    let listId = 'WUlnZzdORlJwa01PTEFVSw' // FloodDoctor default
    let listName = 'FloodDoctor'
    let priority = null
    let dueDate = null
    let category = null

    // Check for personal list
    if (/^personal\b/i.test(text)) {
      listId = 'NE1SZ0pXUF9hT2pVczFUQg'
      listName = 'Personal'
      text = text.replace(/^personal\s*/i, '')
    }

    // Extract priority: "urgent:", "!high", "!low", "high:", "critical:"
    const priorityMatch = text.match(/(?:^|\s)(urgent|critical|!high|!medium|!low|high:|medium:|low:)/i)
    if (priorityMatch) {
      const p = priorityMatch[1].toLowerCase().replace(/[!:]/, '')
      priority = p === 'critical' ? 'urgent' : p
      text = text.replace(priorityMatch[0], ' ').trim()
    }

    // Extract category: "@insurance", "@billing", "@crew", "@client"
    const catMatch = text.match(/@(insurance|billing|crew|client|marketing|seo|admin)/i)
    if (catMatch) {
      category = catMatch[1].toLowerCase()
      text = text.replace(catMatch[0], ' ').trim()
    }

    // Extract due date: "by tomorrow", "by friday", "by 3/20", "due 2026-03-20"
    const duePhrases = [
      { pattern: /\b(?:by|due)\s+today\b/i, resolve: () => this.resolveRelativeDate(0) },
      { pattern: /\b(?:by|due)\s+tomorrow\b/i, resolve: () => this.resolveRelativeDate(1) },
      { pattern: /\b(?:by|due)\s+(?:next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i, resolve: (m) => this.resolveNextDay(m[1]) },
      { pattern: /\b(?:by|due)\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, resolve: (m) => this.resolveMMDD(m[1], m[2], m[3]) },
      { pattern: /\b(?:by|due)\s+(\d{4}-\d{2}-\d{2})\b/, resolve: (m) => m[1] + 'T09:00:00.000Z' },
    ]

    for (const { pattern, resolve } of duePhrases) {
      const match = text.match(pattern)
      if (match) {
        dueDate = resolve(match)
        text = text.replace(match[0], ' ').trim()
        break
      }
    }

    // Clean up double spaces
    const taskTitle = text.replace(/\s{2,}/g, ' ').trim()

    // Build display title with priority prefix
    let displayTitle = taskTitle
    if (priority === 'urgent') displayTitle = `🔴 ${taskTitle}`
    else if (priority === 'high') displayTitle = `🟠 ${taskTitle}`
    else if (priority === 'medium') displayTitle = `🟡 ${taskTitle}`

    if (category) displayTitle = `[${category}] ${displayTitle}`

    return { listId, listName, taskTitle: displayTitle, dueDate, priority, category }
  }

  resolveRelativeDate(daysFromNow) {
    const d = new Date()
    d.setDate(d.getDate() + daysFromNow)
    return d.toISOString().split('T')[0] + 'T09:00:00.000Z'
  }

  resolveNextDay(dayName) {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    const target = days.indexOf(dayName.toLowerCase())
    const today = new Date().getDay()
    let diff = target - today
    if (diff <= 0) diff += 7
    return this.resolveRelativeDate(diff)
  }

  resolveMMDD(month, day, year) {
    const now = new Date()
    const y = year ? (year.length === 2 ? '20' + year : year) : now.getFullYear().toString()
    const m = month.padStart(2, '0')
    const d = day.padStart(2, '0')
    return `${y}-${m}-${d}T09:00:00.000Z`
  }

  handleTodo(args) {
    if (!args) {
      return {
        handled: true,
        response: [
          'Usage: /todo <task>',
          '/todo personal <task>',
          '/todo urgent: call adjuster by tomorrow',
          '/todo !high @insurance follow up with StateFarm by friday',
          '',
          'Priorities: urgent, !high, !medium, !low',
          'Categories: @insurance @billing @crew @client @marketing @seo @admin',
          'Due: by today, by tomorrow, by friday, by 3/20'
        ].join('\n')
      }
    }

    const { listId, listName, taskTitle, dueDate, priority, category } = this.parseTodoInput(args)

    if (!taskTitle) {
      return { handled: true, response: 'Task text is empty after parsing.' }
    }

    try {
      const args = ['tasks', 'tasks', 'insert', '--tasklist', listId, '--title', taskTitle]
      if (dueDate) args.push('--due', dueDate)
      execFileSync(config.paths.gwsBin, args, { encoding: 'utf-8', timeout: 10000 })

      const parts = [`Added to ${listName}: ${taskTitle}`]
      if (dueDate) {
        const dateStr = new Date(dueDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
        parts.push(`Due: ${dateStr}`)
      }
      return { handled: true, response: parts.join('\n') }
    } catch (err) {
      return { handled: true, response: `Failed to add task: ${err.message}` }
    }
  }

  /**
   * Handle /todos - list pending tasks from Google Tasks
   * Usage: /todos or /todos personal
   */
  handleTodos(args) {
    let listId = 'WUlnZzdORlJwa01PTEFVSw'
    let listName = 'FloodDoctor'

    if (args && args.toLowerCase().startsWith('personal')) {
      listId = 'NE1SZ0pXUF9hT2pVczFUQg'
      listName = 'Personal'
    }

    try {
      const raw = execSync(
        `${config.paths.gwsBin} tasks tasks list --tasklist "${listId}" --showCompleted false`,
        { encoding: 'utf-8', timeout: 15000 }
      )

      // Parse the gws output (JSON array)
      let tasks
      try {
        const parsed = JSON.parse(raw)
        tasks = parsed.items || parsed || []
      } catch {
        // Fallback: just show raw output truncated
        return { handled: true, response: `${listName} Tasks:\n${raw.substring(0, 1500)}` }
      }

      if (!tasks.length) {
        return { handled: true, response: `${listName}: No pending tasks` }
      }

      const lines = [`${listName} Tasks (${tasks.length}):`, '']
      for (const t of tasks.slice(0, 15)) {
        let line = `${t.title || t.name || 'Untitled'}`
        if (t.due) {
          const d = new Date(t.due)
          const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          line += ` (${dateStr})`
        }
        lines.push(line)
      }

      if (tasks.length > 15) {
        lines.push(`... +${tasks.length - 15} more`)
      }

      return { handled: true, response: lines.join('\n') }
    } catch (err) {
      return { handled: true, response: `Failed to list tasks: ${err.message}` }
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

  /**
   * Handle /inbox - show team messages waiting for Frank
   * Usage: /inbox or /inbox clear
   */
  handleInbox(args) {
    const INBOX_FILE = config.paths.teamInboxFile

    if (args && args.toLowerCase() === 'clear') {
      try {
        if (fs.existsSync(INBOX_FILE)) {
          const today = new Date().toISOString().split('T')[0]
          const archivePath = INBOX_FILE.replace('.jsonl', `-${today}.jsonl`)
          fs.renameSync(INBOX_FILE, archivePath)
          return { handled: true, response: `Inbox archived to team-inbox-${today}.jsonl` }
        }
        return { handled: true, response: 'Inbox already empty' }
      } catch (err) {
        return { handled: true, response: `Failed to clear inbox: ${err.message}` }
      }
    }

    try {
      if (!fs.existsSync(INBOX_FILE)) {
        return { handled: true, response: 'No team messages in inbox' }
      }

      const raw = fs.readFileSync(INBOX_FILE, 'utf-8').trim()
      if (!raw) return { handled: true, response: 'No team messages in inbox' }

      const entries = raw.split('\n').map(line => {
        try { return JSON.parse(line) } catch { return null }
      }).filter(Boolean)

      if (entries.length === 0) {
        return { handled: true, response: 'No team messages in inbox' }
      }

      // Group by sender
      const bySender = {}
      for (const e of entries) {
        const key = e.from || 'Unknown'
        if (!bySender[key]) bySender[key] = []
        bySender[key].push(e)
      }

      // Build summary with urgent items first
      const urgent = entries.filter(e => e.category === 'urgent' || e.category === 'action-needed')
      const lines = [`Team Inbox (${entries.length} messages):`, '']

      if (urgent.length) {
        lines.push('URGENT/ACTION NEEDED:')
        for (const u of urgent) {
          const time = u.ts ? new Date(u.ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''
          lines.push(`  ${u.from}: ${u.summary || u.raw?.substring(0, 80) || 'no details'}${time ? ` (${time})` : ''}`)
        }
        lines.push('')
      }

      for (const [sender, msgs] of Object.entries(bySender)) {
        const nonUrgent = msgs.filter(m => m.category !== 'urgent' && m.category !== 'action-needed')
        if (nonUrgent.length === 0) continue
        lines.push(`${sender} (${nonUrgent.length}):`)
        for (const m of nonUrgent.slice(0, 3)) {
          lines.push(`  ${m.summary || m.raw?.substring(0, 80) || 'no details'}`)
        }
        if (nonUrgent.length > 3) lines.push(`  +${nonUrgent.length - 3} more`)
      }

      lines.push('', '/inbox clear to archive')

      return { handled: true, response: lines.join('\n') }
    } catch (err) {
      return { handled: true, response: `Failed to read inbox: ${err.message}` }
    }
  }

  handleHelp() {
    const lines = [
      'Atlas Commands',
      '',
      '/new or /reset - Start fresh session',
      '/status - Show session status',
      '/briefing - Morning briefing on demand',
      '/inbox - Team messages waiting for you',
      '/inbox clear - Archive team inbox',
      '/memory - Show memory summary',
      '/memory list - List memory files',
      '/memory search <query> - Search memories',
      '/queue - Show queue status',
      '/model - Switch AI model',
      '/model 2 - Switch to model by number',
      '/todo <task> - Add to FloodDoctor tasks',
      '/todo personal <task> - Add to Personal tasks',
      '/todo urgent: <task> by friday - Priority + due date',
      '/todo !high @insurance <task> - Priority + category',
      '/todos - List pending tasks',
      '/todos personal - List personal tasks',
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
