import BaseAdapter from './base.js'

/**
 * Twilio WhatsApp adapter for Atlas
 * Uses Twilio REST API for sending, webhook for receiving
 * Drop-in replacement for Baileys adapter — same interface, stable connection
 */
export default class TwilioWhatsAppAdapter extends BaseAdapter {
  constructor(config) {
    super(config)
    this.accountSid = config.accountSid
    this.authToken = config.authToken
    this.whatsappNumber = config.whatsappNumber // e.g. +14155238886
    this.gateway = null // Set by gateway before start()

    // Normalize allowedDMs: accept bare numbers, add @s.whatsapp.net if missing
    if (this.config.allowedDMs) {
      this.config.allowedDMs = this.config.allowedDMs.map(entry => {
        if (entry === '*') return entry
        if (entry.includes('@')) return entry
        return `${entry}@s.whatsapp.net`
      })
    }
  }

  async start() {
    // Validate required config
    if (!this.accountSid || !this.authToken || !this.whatsappNumber) {
      throw new Error(
        'Twilio WhatsApp adapter requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_WHATSAPP_NUMBER'
      )
    }

    // Register webhook route on the gateway HTTP server
    if (this.gateway && this.gateway.httpServer) {
      console.log('[Twilio] Webhook route will be registered when HTTP server starts')
    }

    // Store the webhook handler so gateway can call it
    this._webhookHandler = (req, res) => this._handleWebhook(req, res)

    console.log(`[Twilio] WhatsApp adapter started (number: ${this.whatsappNumber})`)
    console.log(`[Twilio] Webhook endpoint: POST /webhook/twilio`)
  }

  async stop() {
    this._webhookHandler = null
    console.log('[Twilio] WhatsApp adapter stopped')
  }

  /**
   * Send a message via Twilio REST API
   */
  async sendMessage(chatId, text) {
    const phone = chatId.replace('@s.whatsapp.net', '').replace(/^(\d)/, '+$1')
    const from = `whatsapp:${this.whatsappNumber}`
    const to = `whatsapp:${phone}`

    const params = new URLSearchParams({
      From: from,
      To: to,
      Body: text
    })

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
      }
    )

    const data = await response.json()
    if (data.error_code) {
      throw new Error(`Twilio error ${data.error_code}: ${data.error_message}`)
    }

    return data
  }

  /**
   * Typing indicators are not supported by Twilio WhatsApp API
   */
  async sendTyping(chatId) {
    // No-op: Twilio doesn't support typing indicators
  }

  async stopTyping(chatId) {
    // No-op
  }

  /**
   * Handle incoming Twilio webhook POST
   * Twilio sends application/x-www-form-urlencoded body
   */
  _handleWebhook(req, res) {
    let body = ''
    let bodySize = 0
    const MAX_BODY = 1024 * 1024 // 1MB

    req.on('data', chunk => {
      bodySize += chunk.length
      if (bodySize > MAX_BODY) {
        req.destroy()
        res.writeHead(413, { 'Content-Type': 'text/plain' })
        res.end('Request too large')
        return
      }
      body += chunk
    })

    req.on('end', () => {
      try {
        const params = new URLSearchParams(body)
        const from = params.get('From') || ''       // whatsapp:+17034981581
        const msgBody = params.get('Body') || ''
        const messageSid = params.get('MessageSid') || ''
        const numMedia = parseInt(params.get('NumMedia') || '0', 10)

        // Respond with empty 200 immediately (Twilio expects fast response)
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('')

        if (!from || !msgBody) {
          console.log('[Twilio] Webhook received but no From/Body, ignoring')
          return
        }

        // Convert Twilio format to internal format
        // from = "whatsapp:+17034981581" -> chatId = "+17034981581@s.whatsapp.net"
        const phone = from.replace('whatsapp:', '')
        const chatId = `${phone.replace('+', '')}@s.whatsapp.net`

        console.log(`[Twilio] Incoming: from=${phone}, body="${msgBody.substring(0, 50)}", sid=${messageSid}`)

        // With Twilio, every message to this number is for Atlas (no self-chat concept)
        // Still support "Atlas," prefix for consistency, but strip it
        let text = msgBody
        let isAtlas = true // Always true for Twilio DMs

        const lower = text.trim().toLowerCase()
        const atlasPrefixes = ['atlas,', 'atlas ', 'hey atlas,', 'hey atlas ', 'cc,', 'cc ', 'hey cc,', 'hey cc ']
        for (const prefix of atlasPrefixes) {
          if (lower.startsWith(prefix)) {
            text = text.trim().slice(prefix.length).trim()
            break
          }
        }

        // If just "atlas" or "hey atlas" alone, treat as greeting
        const standalones = ['atlas', 'hey atlas', 'cc', 'hey cc']
        if (standalones.includes(lower)) {
          text = ''
        }

        // Handle media attachments (basic support)
        let image = null
        if (numMedia > 0) {
          const mediaUrl = params.get('MediaUrl0')
          const mediaType = params.get('MediaContentType0')
          if (mediaUrl && mediaType && mediaType.startsWith('image/')) {
            // Twilio media URLs require auth to download
            image = {
              url: mediaUrl,
              mediaType
            }
            console.log(`[Twilio] Media attached: ${mediaType} at ${mediaUrl}`)
          }
          if (!text) {
            text = '[Image]'
          }
        }

        if (!text && !image) return

        this.emitMessage({
          chatId,
          text,
          isGroup: false, // Twilio WhatsApp DMs are always 1:1
          isAtlas,
          sender: chatId,
          mentions: [],
          image,
          raw: {
            messageSid,
            from: phone,
            numMedia,
            params: Object.fromEntries(params)
          }
        })
      } catch (err) {
        console.error('[Twilio] Webhook parse error:', err.message)
        // Already sent 200 or will send error
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain' })
          res.end('Internal error')
        }
      }
    })
  }
}
