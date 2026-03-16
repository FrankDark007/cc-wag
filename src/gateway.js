import 'dotenv/config'
import http from 'http'
import QRCode from 'qrcode'
import config from './config.js'
import WhatsAppAdapter from './adapters/whatsapp.js'
import SessionManager from './sessions/manager.js'
import AgentRunner from './agent/runner.js'
import CommandHandler from './commands/handler.js'

/**
 * CC-WAG: Claude Code WhatsApp Gateway
 * Routes messages between WhatsApp and Claude agent
 */
class Gateway {
  constructor() {
    this.sessionManager = new SessionManager()
    this.agentRunner = new AgentRunner(this.sessionManager, {
      allowedTools: config.agent?.allowedTools || ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
      maxTurns: config.agent?.maxTurns || 50,
      permissionMode: 'bypassPermissions',
    })
    this.commandHandler = new CommandHandler(this)
    this.adapters = new Map()
    this.pendingApprovals = new Map() // chatId -> { resolve, timeout }
    this.mcpServers = {}
    this.setupQueueMonitoring()
    this.setupAgentMonitoring()
    this.setupCronExecution()
  }

  setupQueueMonitoring() {
    this.agentRunner.on('queued', ({ runId, sessionKey, position, queueLength }) => {
      if (position > 0) {
        console.log(`[Queue] Queued: position ${position + 1}, ${queueLength} pending`)
      }
    })

    this.agentRunner.on('processing', ({ runId, waitTimeMs, remainingInQueue }) => {
      if (waitTimeMs > 100) {
        console.log(`[Queue] Processing (waited ${Math.round(waitTimeMs)}ms, ${remainingInQueue} remaining)`)
      }
    })

    this.agentRunner.on('completed', ({ runId, processingTimeMs }) => {
      console.log(`[Queue] Completed in ${Math.round(processingTimeMs)}ms`)
    })

    this.agentRunner.on('failed', ({ runId, error }) => {
      console.log(`[Queue] Failed: ${error}`)
    })
  }

  setupAgentMonitoring() {
    this.agentRunner.on('agent:tool', ({ sessionKey, name }) => {
      console.log(`[Agent] Using tool: ${name}`)
    })
  }

  setupCronExecution() {
    this.agentRunner.agent.cronScheduler.on('execute', async ({ jobId, platform, chatId, sessionKey, message, invokeAgent }) => {
      console.log(`[Cron] Executing job ${jobId}${invokeAgent ? ' (invoking agent)' : ''}`)

      const adapter = this.adapters.get(platform)
      if (!adapter) {
        console.error(`[Cron] No adapter for platform: ${platform}`)
        return
      }

      try {
        if (invokeAgent) {
          console.log(`[Cron] Invoking agent with: ${message}`)
          const response = await this.agentRunner.agent.runAndCollect({
            message,
            sessionKey: sessionKey || `cron:${jobId}`,
            platform,
            chatId,
            mcpServers: this.mcpServers
          })

          if (response) {
            await adapter.sendMessage(chatId, response)
            console.log(`[Cron] Agent response sent for job ${jobId}`)
          }
        } else {
          await adapter.sendMessage(chatId, message)
          console.log(`[Cron] Message sent for job ${jobId}`)
        }
      } catch (err) {
        console.error(`[Cron] Failed to execute job:`, err.message)
      }
    })
  }

  /**
   * Send a message and wait for the user's reply.
   * Used for tool approval prompts and clarifying questions.
   */
  waitForApproval(chatId, adapter, message, timeoutMs = 120000) {
    const existing = this.pendingApprovals.get(chatId)
    if (existing) {
      clearTimeout(existing.timeout)
      existing.resolve(null)
    }

    return new Promise(async (resolve) => {
      const timeout = setTimeout(() => {
        this.pendingApprovals.delete(chatId)
        resolve(null)
      }, timeoutMs)

      this.pendingApprovals.set(chatId, { resolve, timeout })

      try {
        await adapter.sendMessage(chatId, message)
      } catch (err) {
        console.error('[Gateway] Failed to send approval prompt:', err.message)
        clearTimeout(timeout)
        this.pendingApprovals.delete(chatId)
        resolve(null)
      }
    })
  }

  async start() {
    console.log('='.repeat(50))
    console.log('CC-WAG: Claude Code WhatsApp Gateway')
    console.log('='.repeat(50))
    console.log(`Agent ID: ${config.agentId}`)
    console.log(`Workspace: /Users/ghost/Projects/cc-wag/`)
    console.log(`Model: ${process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929'}`)
    console.log('')

    const dms = config.whatsapp.allowedDMs?.length ? config.whatsapp.allowedDMs.join(', ') : 'NONE (all blocked)'
    const groups = config.whatsapp.allowedGroups?.length ? config.whatsapp.allowedGroups.join(', ') : 'NONE (all blocked)'
    console.log(`[Security] WhatsApp: DMs=${dms} | Groups=${groups}`)

    this.agentRunner.setMcpServers(this.mcpServers)

    // Pre-initialize provider
    if (this.agentRunner.agent.provider.initialize) {
      try {
        await this.agentRunner.agent.provider.initialize()
        console.log('[Provider] Claude ready')
      } catch (err) {
        console.error('[Provider] Init failed:', err.message)
      }
    }

    this.agentRunner.agent.gateway = this

    // Initialize WhatsApp adapter
    if (config.whatsapp.enabled) {
      console.log('[Gateway] Initializing WhatsApp adapter...')
      const whatsapp = new WhatsAppAdapter(config.whatsapp, config.selfChat)
      this.setupAdapter(whatsapp, 'whatsapp', config.whatsapp)
      this.adapters.set('whatsapp', whatsapp)

      try {
        await whatsapp.start()
      } catch (err) {
        console.error('[Gateway] WhatsApp adapter failed to start:', err.message)
      }
    }

    // Handle shutdown
    process.on('SIGINT', () => this.stop())
    process.on('SIGTERM', () => this.stop())

    // Start HTTP server
    this.startHttpServer()

    console.log('')
    console.log('[Gateway] Ready and listening for messages')
    console.log('[Gateway] Using Claude Agent SDK with memory + cron')
    console.log('[Gateway] Commands: /help, /new, /status, /memory, /stop, /todo')
  }

  setupAdapter(adapter, platform, platformConfig) {
    adapter.onMessage(async (message) => {
      const sessionKey = adapter.generateSessionKey(config.agentId, platform, message)

      console.log('')
      console.log(`[${platform.toUpperCase()}] Incoming message:`)
      console.log(`  Session: ${sessionKey}`)
      console.log(`  From: ${message.sender}`)
      console.log(`  Group: ${message.isGroup}`)
      console.log(`  Text: ${message.text.substring(0, 100)}${message.text.length > 100 ? '...' : ''}`)
      if (message.image) {
        console.log(`  Image: ${Math.round(message.image.data.length / 1024)}KB`)
      }

      // Check for pending approval
      const pending = this.pendingApprovals.get(message.chatId)
      if (pending) {
        console.log(`[${platform.toUpperCase()}] Resolving pending approval with: ${message.text}`)
        clearTimeout(pending.timeout)
        this.pendingApprovals.delete(message.chatId)
        pending.resolve(message.text)
        return
      }

      // Check for pending /model selection
      if (this.commandHandler.handlePendingReply(message.text, message.chatId)) {
        console.log(`[${platform.toUpperCase()}] Resolved pending command selection: ${message.text}`)
        return
      }

      try {
        // Check for slash commands first
        const commandResult = await this.commandHandler.execute(
          message.text,
          sessionKey,
          adapter,
          message.chatId
        )

        if (commandResult.handled) {
          console.log(`[${platform.toUpperCase()}] Command handled: ${message.text.split(' ')[0]}`)
          if (commandResult.response) {
            await adapter.sendMessage(message.chatId, commandResult.response)
          }
          return
        }

        // Show typing indicator
        if (adapter.sendTyping) {
          await adapter.sendTyping(message.chatId)
        }

        const queueStatus = this.agentRunner.getQueueStatus(sessionKey)
        if (queueStatus.pending > 0 && adapter.react && message.raw?.key?.id) {
          await adapter.react(message.chatId, message.raw.key.id, '...')
        }

        // Enqueue agent run
        console.log(`[${platform.toUpperCase()}] Processing...`)
        const response = await this.agentRunner.enqueueRun(
          sessionKey,
          message.text,
          adapter,
          message.chatId,
          message.image
        )

        if (adapter.stopTyping) {
          await adapter.stopTyping(message.chatId)
        }

        console.log(`[${platform.toUpperCase()}] Done`)
      } catch (error) {
        console.error(`[${platform.toUpperCase()}] Error:`, error.message)

        if (adapter.stopTyping) {
          await adapter.stopTyping(message.chatId)
        }

        try {
          await adapter.sendMessage(
            message.chatId,
            "Sorry, I hit an error. Please try again."
          )
        } catch (sendErr) {
          console.error(`[${platform.toUpperCase()}] Failed to send error message:`, sendErr.message)
        }
      }
    })
  }

  startHttpServer() {
    const port = config.gateway.port || 4096
    const apiToken = config.gateway.apiToken

    this.httpServer = http.createServer(async (req, res) => {
      // QR code page
      if (req.url === '/qr') {
        const wa = this.adapters.get('whatsapp')
        if (!wa || !wa.latestQr) {
          res.writeHead(200, { 'Content-Type': 'text/html' })
          const status = wa?.myJid ? 'WhatsApp is connected.' : 'No QR code available. Waiting for WhatsApp...'
          res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="5"><title>CC-WAG QR</title><style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#111;color:#fff}</style></head><body><p>${status}</p></body></html>`)
          return
        }

        try {
          const qrDataUrl = await QRCode.toDataURL(wa.latestQr, { width: 400, margin: 2 })
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="10"><title>CC-WAG QR</title><style>body{font-family:system-ui;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#111;color:#fff}img{border-radius:12px}</style></head><body><h2>Scan with WhatsApp</h2><img src="${qrDataUrl}" alt="QR Code"/><p>Page refreshes automatically.</p></body></html>`)
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/plain' })
          res.end('Failed to generate QR')
        }
        return
      }

      // Health check
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        const wa = this.adapters.get('whatsapp')
        res.end(JSON.stringify({
          status: 'ok',
          whatsapp: { connected: !!wa?.myJid },
          uptime: process.uptime(),
          queued: this.agentRunner.getGlobalStats().totalPending
        }))
        return
      }

      // POST /api/send - outbound messaging endpoint
      if (req.url === '/api/send' && req.method === 'POST') {
        // Authenticate
        const authHeader = req.headers['authorization']
        const token = authHeader?.replace('Bearer ', '')
        if (!apiToken || token !== apiToken) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Unauthorized' }))
          return
        }

        let body = ''
        req.on('data', chunk => { body += chunk })
        req.on('end', async () => {
          try {
            const { chat_id, message } = JSON.parse(body)
            if (!chat_id || !message) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'chat_id and message required' }))
              return
            }

            const wa = this.adapters.get('whatsapp')
            if (!wa) {
              res.writeHead(503, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'WhatsApp not connected' }))
              return
            }

            await wa.sendMessage(chat_id, message)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true, chat_id, message_length: message.length }))
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: err.message }))
          }
        })
        return
      }

      // Default: status
      res.writeHead(200, { 'Content-Type': 'application/json' })
      const wa = this.adapters.get('whatsapp')
      res.end(JSON.stringify({
        name: 'CC-WAG',
        status: 'ok',
        whatsapp: { connected: !!wa?.myJid }
      }))
    })

    this.httpServer.listen(port, () => {
      console.log(`[HTTP] Listening on port ${port} (QR at /qr, health at /health, send at POST /api/send)`)
    })
  }

  async stop() {
    console.log('\n[Gateway] Shutting down...')

    // Stop cron scheduler
    this.agentRunner.agent.stopCron()

    for (const adapter of this.adapters.values()) {
      try {
        await adapter.stop()
      } catch (err) {
        console.error('[Gateway] Error stopping adapter:', err.message)
      }
    }

    if (this.httpServer) {
      this.httpServer.close()
    }

    console.log('[Gateway] Goodbye!')
    process.exit(0)
  }
}

// Start the gateway
const gateway = new Gateway()
gateway.start().catch((err) => {
  console.error('[Gateway] Fatal error:', err)
  process.exit(1)
})
