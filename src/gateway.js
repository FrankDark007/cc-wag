import 'dotenv/config'
import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import QRCode from 'qrcode'
import config from './config.js'
import WhatsAppAdapter from './adapters/whatsapp.js'
import SessionManager from './sessions/manager.js'
import AgentRunner from './agent/runner.js'
import CommandHandler from './commands/handler.js'
import { scrubSecrets } from './utils/mask-secrets.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MAX_BODY_SIZE = 1024 * 1024 // 1MB

/**
 * Atlas: WhatsApp AI Executive Assistant
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
    this.pendingLocationRequests = new Map() // requestId -> { resolve, timeout }
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

      // Check WhatsApp connection before invoking agent (no point burning tokens if we can't deliver)
      if (invokeAgent && !this.isWhatsAppReady()) {
        console.warn(`[Cron] WhatsApp not ready — skipping agent invocation for job ${jobId} to save tokens`)
        return
      }

      // Check daily agent invocation limit
      if (invokeAgent && !this.agentRunner.agent.cronScheduler.checkAgentInvocationLimit()) {
        console.warn(`[Cron] Daily agent limit reached — skipping job ${jobId}`)
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
   * Check if WhatsApp adapter is ready to deliver messages.
   * For Twilio: adapter exists and has valid credentials.
   * For Baileys: adapter exists and has a connected socket.
   */
  isWhatsAppReady() {
    const wa = this.adapters.get('whatsapp')
    if (!wa) return false
    // Twilio adapter: no persistent socket, check credentials exist
    if (wa._webhookHandler !== undefined) {
      return !!(wa.accountSid && wa.authToken && wa.whatsappNumber)
    }
    // Baileys adapter: check socket connection
    return !!wa.myJid
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

  /**
   * Request location from Frank's phone via Tasker + Join push.
   * Returns { lat, lng, accuracy, timestamp } or null on timeout.
   */
  async requestLocation() {
    const { joinApiKey, joinDeviceId, timeoutMs } = config.location
    if (!joinApiKey || !joinDeviceId) {
      return { error: 'Join API not configured (JOIN_API_KEY / JOIN_DEVICE_ID missing)' }
    }

    const requestId = `loc_${Date.now()}`

    // Push to Tasker via Join API
    const joinUrl = `https://joinjoaomgcd.appspot.com/_ah/api/messaging/v1/sendPush` +
      `?apikey=${joinApiKey}&deviceId=${joinDeviceId}` +
      `&text=location_request:${requestId}`

    try {
      const resp = await fetch(joinUrl)
      if (!resp.ok) {
        return { error: `Join push failed: HTTP ${resp.status}` }
      }
      console.log(`[Location] Push sent, waiting for response (id: ${requestId})`)
    } catch (err) {
      return { error: `Join push failed: ${err.message}` }
    }

    // Wait for Tasker to POST back to /api/location
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingLocationRequests.delete(requestId)
        resolve({ error: 'Phone did not respond within 30s' })
      }, timeoutMs || 30000)

      this.pendingLocationRequests.set(requestId, { resolve, timeout })
    })
  }

  /**
   * Resolve a pending location request (called from POST /api/location)
   */
  resolveLocationRequest(requestId, data) {
    const pending = this.pendingLocationRequests.get(requestId)
    if (!pending) return false

    clearTimeout(pending.timeout)
    this.pendingLocationRequests.delete(requestId)
    pending.resolve(data)
    return true
  }

  async start() {
    console.log('='.repeat(50))
    console.log('Atlas: WhatsApp AI Executive Assistant')
    console.log('='.repeat(50))
    console.log(`Agent ID: ${config.agentId}`)
    console.log(`Workspace: ${config.paths.root}/`)
    console.log(`Model: ${config.model}`)
    console.log('')

    // Validate config
    const { validateConfig } = await import('./config.js')
    validateConfig(config)

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

    // Initialize WhatsApp adapter (Baileys or Twilio)
    if (config.whatsapp.enabled) {
      const adapterType = process.env.WHATSAPP_ADAPTER || 'baileys'
      console.log(`[Gateway] Initializing WhatsApp adapter (${adapterType})...`)

      try {
        if (adapterType === 'twilio') {
          const { default: TwilioWhatsAppAdapter } = await import('./adapters/twilio-whatsapp.js')
          const twilio = new TwilioWhatsAppAdapter({
            accountSid: process.env.TWILIO_ACCOUNT_SID,
            authToken: process.env.TWILIO_AUTH_TOKEN,
            whatsappNumber: process.env.TWILIO_WHATSAPP_NUMBER,
            webhookUrl: process.env.TWILIO_WEBHOOK_URL,
            allowedDMs: config.whatsapp.allowedDMs,
            allowedGroups: config.whatsapp.allowedGroups,
            respondToMentionsOnly: config.whatsapp.respondToMentionsOnly,
          })
          twilio.gateway = this
          await twilio.start()
          this.setupAdapter(twilio, 'whatsapp', config.whatsapp)
          this.adapters.set('whatsapp', twilio)
        } else {
          const whatsapp = new WhatsAppAdapter(config.whatsapp, config.selfChat)
          this.setupAdapter(whatsapp, 'whatsapp', config.whatsapp)
          this.adapters.set('whatsapp', whatsapp)
          await whatsapp.start()
        }
      } catch (err) {
        console.error('[Gateway] WhatsApp adapter failed to start:', err.message)
      }
    }

    // Load feature plugins from src/features/
    await this.loadFeatures()

    // Handle shutdown
    process.on('SIGINT', () => this.stop())
    process.on('SIGTERM', () => this.stop())

    // Auto-restart WhatsApp connection every 6 hours to prevent session degradation
    this._connectionResetTimer = setInterval(() => {
      const whatsapp = this.adapters?.get('whatsapp')
      if (whatsapp?.sock) {
        console.log('[Gateway] Scheduled connection refresh — cleaning stale sessions')
        try {
          const authDir = config.paths.authDir
          const sessionFiles = fs.readdirSync(authDir).filter(f => f.startsWith('session-'))
          for (const f of sessionFiles) fs.unlinkSync(path.join(authDir, f))
          if (sessionFiles.length) console.log(`[Gateway] Cleaned ${sessionFiles.length} session files`)
        } catch (e) {
          console.error('[Gateway] Session cleanup failed:', e.message)
        }
      }
    }, 6 * 60 * 60 * 1000) // every 6 hours

    // Bad MAC auto-recovery: track repeated errors per contact, auto-delete corrupted session keys
    this._badMacCounts = new Map() // contactId -> { count, firstSeen }
    const BAD_MAC_THRESHOLD = 5   // errors before auto-cleanup
    const BAD_MAC_WINDOW = 60000  // within 1 minute

    const handleBadMac = (err) => {
      const msg = err?.message || String(err)
      if (!msg.includes('Bad MAC') && !msg.includes('Bad encrypted message')) return false

      // Extract contact ID from stack trace (the async queue job names contain it)
      const stack = err?.stack || ''
      const contactMatch = stack.match(/(\d{10,20})\.\d+/)
      const contactId = contactMatch ? contactMatch[1] : 'unknown'

      const now = Date.now()
      const entry = this._badMacCounts.get(contactId) || { count: 0, firstSeen: now }

      // Reset counter if outside window
      if (now - entry.firstSeen > BAD_MAC_WINDOW) {
        entry.count = 0
        entry.firstSeen = now
      }

      entry.count++
      this._badMacCounts.set(contactId, entry)

      if (entry.count === 1) {
        console.error(`[Gateway] Bad MAC for contact ${contactId} (1/${BAD_MAC_THRESHOLD})`)
      }

      if (entry.count >= BAD_MAC_THRESHOLD) {
        console.error(`[Gateway] Bad MAC threshold hit for ${contactId} — auto-cleaning session keys`)
        this._badMacCounts.delete(contactId)

        // Delete corrupted session files for this contact
        try {
          const authDir = config.paths.authDir
          const files = fs.readdirSync(authDir).filter(f => f.includes(`session-${contactId}`))
          for (const file of files) {
            fs.unlinkSync(path.join(authDir, file))
            console.log(`[Gateway] Deleted corrupted session: ${file}`)
          }
          if (files.length > 0) {
            console.log(`[Gateway] Cleaned ${files.length} session file(s) for ${contactId} — Baileys will re-negotiate`)
            // Report via error reporter if available
            if (this._errorReporter?.reportBadMacCleanup) {
              this._errorReporter.reportBadMacCleanup(contactId, files.length)
            }
          }
        } catch (cleanErr) {
          console.error(`[Gateway] Failed to clean sessions:`, cleanErr.message)
        }
      }

      return true
    }

    // Prevent crashes from unhandled errors (Bad MAC, libsignal, etc.)
    process.on('unhandledRejection', (err) => {
      if (handleBadMac(err)) return
      console.error('[Gateway] Unhandled rejection:', scrubSecrets(err?.message || String(err)))
    })
    process.on('uncaughtException', (err) => {
      if (handleBadMac(err)) return
      console.error('[Gateway] Uncaught exception:', scrubSecrets(err?.message || String(err)))
      // For truly unexpected errors, exit cleanly so launchd restarts us
      setTimeout(() => process.exit(1), 1000)
    })

    // Start HTTP server
    this.startHttpServer()

    console.log('')
    console.log('[Gateway] Ready and listening for messages')
    console.log('[Gateway] Using Claude Agent SDK with memory + cron')
    console.log('[Gateway] Commands: /help, /new, /status, /memory, /stop, /todo')
  }

  /**
   * Load all feature plugins from src/features/
   * Each feature exports a register(gateway) function
   */
  async loadFeatures() {
    const featuresDir = path.join(__dirname, 'features')
    if (!fs.existsSync(featuresDir)) {
      console.log('[Features] No features directory found')
      return
    }

    const files = fs.readdirSync(featuresDir)
      .filter(f => f.endsWith('.js'))
      .sort()

    for (const file of files) {
      try {
        const filePath = pathToFileURL(path.join(featuresDir, file)).href
        const mod = await import(filePath)
        if (typeof mod.register === 'function') {
          mod.register(this)
          console.log(`[Features] Loaded: ${file}`)
        }
      } catch (err) {
        console.error(`[Features] Failed to load ${file}:`, err.message)
      }
    }
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
          message.image,
          { isAtlas: message.isAtlas || false }
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
          res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="5"><title>Atlas QR</title><style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#111;color:#fff}</style></head><body><p>${status}</p></body></html>`)
          return
        }

        try {
          const qrDataUrl = await QRCode.toDataURL(wa.latestQr, { width: 400, margin: 2 })
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="10"><title>Atlas QR</title><style>body{font-family:system-ui;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#111;color:#fff}img{border-radius:12px}</style></head><body><h2>Scan with WhatsApp</h2><img src="${qrDataUrl}" alt="QR Code"/><p>Page refreshes automatically.</p></body></html>`)
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
        const adapterType = process.env.WHATSAPP_ADAPTER || 'baileys'
        // Twilio: connected = adapter started with valid credentials (no persistent socket)
        // Baileys: connected = has myJid (socket authenticated)
        const connected = adapterType === 'twilio'
          ? !!(wa && wa.accountSid && wa.authToken && wa.whatsappNumber)
          : !!wa?.myJid
        res.end(JSON.stringify({
          status: 'ok',
          whatsapp: { connected, adapter: adapterType },
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
        let bodySize = 0
        req.on('data', chunk => {
          bodySize += chunk.length
          if (bodySize > MAX_BODY_SIZE) {
            req.destroy()
            res.writeHead(413, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Request body too large' }))
            return
          }
          body += chunk
        })
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

      // POST /api/location - Tasker posts GPS coordinates here
      if (req.url === '/api/location' && req.method === 'POST') {
        let body = ''
        let bodySize = 0
        req.on('data', chunk => {
          bodySize += chunk.length
          if (bodySize > MAX_BODY_SIZE) {
            req.destroy()
            res.writeHead(413, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Request body too large' }))
            return
          }
          body += chunk
        })
        req.on('end', () => {
          try {
            const { request_id, lat, lng, accuracy, secret } = JSON.parse(body)

            // Authenticate with location secret
            const expectedSecret = config.location.secret
            if (!expectedSecret || secret !== expectedSecret) {
              if (!expectedSecret) console.error('[Location] LOCATION_SECRET not configured — rejecting request')
              res.writeHead(401, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Invalid secret' }))
              return
            }

            if (!request_id || lat == null || lng == null) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'request_id, lat, and lng required' }))
              return
            }

            const resolved = this.resolveLocationRequest(request_id, {
              lat: parseFloat(lat),
              lng: parseFloat(lng),
              accuracy: accuracy ? parseFloat(accuracy) : null,
              timestamp: Date.now()
            })

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true, matched: resolved }))

            console.log(`[Location] Received: ${lat}, ${lng} (accuracy: ${accuracy || 'n/a'}m, matched: ${resolved})`)
          } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Invalid JSON' }))
          }
        })
        return
      }

      // POST /webhook/twilio - Twilio WhatsApp incoming webhook
      if (req.url === '/webhook/twilio' && req.method === 'POST') {
        const wa = this.adapters.get('whatsapp')
        if (wa && wa._webhookHandler) {
          wa._webhookHandler(req, res)
        } else {
          // Fallback: log any incoming SMS even if adapter not active (captures verification codes)
          let body = ''
          req.on('data', chunk => { body += chunk })
          req.on('end', () => {
            try {
              const params = new URLSearchParams(body)
              const from = params.get('From') || ''
              const msgBody = params.get('Body') || ''
              if (msgBody) {
                console.log(`[Twilio-SMS] From: ${from} | Body: ${msgBody}`)
                // Write to file for easy retrieval
                fs.appendFileSync(path.join(config.paths.workspace, 'sms-inbox.log'),
                  `${new Date().toISOString()} | From: ${from} | Body: ${msgBody}\n`)
              }
            } catch (e) { /* ignore parse errors */ }
            res.writeHead(200, { 'Content-Type': 'text/plain' })
            res.end('')
          })
        }
        return
      }

      // Default: status
      res.writeHead(200, { 'Content-Type': 'application/json' })
      const wa = this.adapters.get('whatsapp')
      res.end(JSON.stringify({
        name: 'Atlas',
        status: 'ok',
        whatsapp: { connected: !!wa?.myJid || (wa && !wa.sock) }
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
