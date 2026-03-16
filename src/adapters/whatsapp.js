import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage
} from '@whiskeysockets/baileys'
import qrcode from 'qrcode-terminal'
import pino from 'pino'
import BaseAdapter from './base.js'

const AUTH_DIR = '/Users/ghost/Projects/cc-wag/auth_whatsapp'

/**
 * WhatsApp adapter using Baileys
 * Supports text and image messages
 * Self-chat mode: messages from Frank's own number starting with "CC," prefix
 */
export default class WhatsAppAdapter extends BaseAdapter {
  constructor(config, selfChatConfig = {}) {
    super(config)
    this.sock = null
    this.myJid = null
    this.myLid = null
    this.jidMap = new Map()
    this.latestQr = null
    this.sentMessageIds = new Set()
    // LID<->phone bidirectional maps
    this.lidToPhone = new Map()
    this.phoneToLid = new Map()
    // Self-chat config (Frank messaging himself)
    this.selfChatPrefix = (selfChatConfig.prefix || 'CC,').toLowerCase()
    this.frankPhone = selfChatConfig.frankPhone || '+17034981581'
    // Active self-chat sessions: once "CC," activates a conversation, subsequent messages go through without prefix
    this.activeSelfChatSessions = new Set()
    this.selfChatTimers = new Map() // jid -> timeout handle
    // Team member "Atlas" trigger prefixes
    this.teamTriggers = ['atlas,', 'atlas ', 'hey atlas,', 'hey atlas ']
    // Active team sessions: once "Atlas" activates, subsequent messages go through without prefix
    this.activeTeamSessions = new Set()
    this.teamSessionTimers = new Map() // jid -> timeout handle
    // Normalize allowedDMs: accept bare numbers, add @s.whatsapp.net if missing
    this.config.allowedDMs = this.config.allowedDMs.map(entry => {
      if (entry === '*') return entry
      if (entry.includes('@')) return entry
      return `${entry}@s.whatsapp.net`
    })
  }

  async start() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
    const { version } = await fetchLatestBaileysVersion()

    const logger = pino({ level: 'silent' })

    this.sock = makeWASocket({
      version,
      auth: state,
      logger,
      printQRInTerminal: false,
      generateHighQualityLinkPreview: false
    })

    this.sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update

      if (qr) {
        this.latestQr = qr
        console.log('\n[WhatsApp] Scan QR code to connect:')
        qrcode.generate(qr, { small: true })
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut

        console.log(`[WhatsApp] Connection closed. Status: ${statusCode}`)

        if (statusCode === DisconnectReason.loggedOut) {
          console.log('[WhatsApp] Logged out. Please delete auth_whatsapp/ folder and restart.')
        } else if (shouldReconnect) {
          console.log('[WhatsApp] Reconnecting in 2s...')
          setTimeout(() => this.start(), 2000)
        }
      }

      if (connection === 'open') {
        this.latestQr = null
        this.myJid = this.sock.user?.id
        this.myLid = this.sock.user?.lid || null
        console.log(`[WhatsApp] Connected as ${this.myJid} (LID: ${this.myLid})`)

        // Always allow messaging yourself (self-DM)
        if (!this.config.allowedDMs.includes('*')) {
          if (this.myJid) {
            const selfJid = this.myJid.replace(/:.*@/, '@')
            if (!this.config.allowedDMs.includes(selfJid)) {
              this.config.allowedDMs.push(selfJid)
              console.log(`[WhatsApp] Auto-allowed self-DM (phone): ${selfJid}`)
            }
          }
          if (this.myLid) {
            const selfLid = this.myLid.replace(/:.*@/, '@')
            if (!this.config.allowedDMs.includes(selfLid)) {
              this.config.allowedDMs.push(selfLid)
              console.log(`[WhatsApp] Auto-allowed self-DM (LID): ${selfLid}`)
            }
          }
        }

        // Seed own LID<->phone mapping
        if (this.myJid && this.myLid) {
          this._mapContact(this.myJid, this.myLid)
        }

        // Resolve allowlisted phone numbers to LIDs
        this._resolveAllowlist()
      }
    })

    this.sock.ev.on('creds.update', saveCreds)

    // Learn LID<->phone mappings from all contact-related events
    const learnContacts = (contacts) => {
      let learned = 0
      for (const c of contacts) {
        if (c.id && c.lid) { this._mapContact(c.id, c.lid); learned++ }
      }
      if (learned) console.log(`[WhatsApp] Learned ${learned} contacts (total map: ${this.lidToPhone.size})`)
    }
    this.sock.ev.on('contacts.upsert', learnContacts)
    this.sock.ev.on('contacts.update', learnContacts)
    this.sock.ev.on('messaging-history.set', ({ contacts }) => {
      if (contacts?.length) learnContacts(contacts)
    })

    this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
      console.log(`[WhatsApp] messages.upsert: type=${type}, count=${messages.length}`)
      for (const msg of messages) {
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || ''
        console.log(`[WhatsApp] Message: fromMe=${msg.key.fromMe}, jid=${msg.key.remoteJid}, text="${text.substring(0, 50)}"`)
      }

      if (type !== 'notify') return

      for (const msg of messages) {
        await this.handleMessage(msg)
      }
    })

    console.log('[WhatsApp] Adapter starting...')
  }

  async stop() {
    if (this.sock) {
      this.sock.end()
      this.sock = null
    }
    console.log('[WhatsApp] Adapter stopped')
  }

  async sendMessage(chatId, text) {
    if (!this.sock) {
      throw new Error('WhatsApp not connected')
    }

    // Resolve LID to phone JID for sending (WhatsApp prefers phone JIDs for outbound)
    let targetJid = this.jidMap?.get(chatId) || chatId
    if (targetJid.endsWith('@lid')) {
      const phoneJid = this.lidToPhone.get(targetJid)
      if (phoneJid) {
        targetJid = phoneJid
        console.log(`[WhatsApp] Resolved LID to phone JID: ${targetJid}`)
      }
    }
    const sentMsg = await this.sock.sendMessage(targetJid, { text })

    // Track sent message ID so we can filter out our own echoes in self-DMs
    if (sentMsg?.key?.id) {
      this.sentMessageIds.add(sentMsg.key.id)
      setTimeout(() => this.sentMessageIds.delete(sentMsg.key.id), 10000)
    }
  }

  async sendTyping(chatId) {
    if (!this.sock) return
    try {
      await this.sock.sendPresenceUpdate('composing', chatId)
    } catch (err) {
      // Ignore
    }
  }

  async stopTyping(chatId) {
    if (!this.sock) return
    try {
      await this.sock.sendPresenceUpdate('paused', chatId)
    } catch (err) {
      // Ignore
    }
  }

  async react(chatId, messageId, emoji) {
    if (!this.sock) return
    try {
      await this.sock.sendMessage(chatId, {
        react: { text: emoji, key: { remoteJid: chatId, id: messageId } }
      })
    } catch (err) {
      // Ignore
    }
  }

  /**
   * Download image from message
   */
  async downloadImage(msg) {
    try {
      const buffer = await downloadMediaMessage(
        msg,
        'buffer',
        {},
        {
          logger: pino({ level: 'silent' }),
          reuploadRequest: this.sock.updateMediaMessage
        }
      )
      return buffer
    } catch (err) {
      console.error('[WhatsApp] Failed to download image:', err.message)
      return null
    }
  }

  /**
   * At connection time, resolve allowlisted phone numbers to their LIDs
   */
  async _resolveAllowlist() {
    const phoneEntries = this.config.allowedDMs.filter(e => e.endsWith('@s.whatsapp.net'))
    if (!phoneEntries.length || this.config.allowedDMs.includes('*')) return

    console.log(`[WhatsApp] Resolving ${phoneEntries.length} allowlisted numbers...`)
    for (const phoneJid of phoneEntries) {
      if (this.phoneToLid.has(phoneJid)) continue
      const num = phoneJid.replace('@s.whatsapp.net', '')
      try {
        const [result] = await this.sock.onWhatsApp(num)
        if (result) {
          if (result.lid) {
            const lid = result.lid.replace(/:.*@/, '@')
            this._mapContact(phoneJid, lid)
            if (!this.config.allowedDMs.includes(lid)) {
              this.config.allowedDMs.push(lid)
            }
            console.log(`[WhatsApp] Resolved ${num} -> LID ${lid}`)
          }
        }
      } catch (err) {
        console.log(`[WhatsApp] Could not resolve ${num}: ${err.message}`)
      }
    }
    console.log(`[WhatsApp] Allowlist resolved (${this.lidToPhone.size} LID<->phone pairs)`)
  }

  /**
   * Store a LID<->phone mapping (strips :device suffixes)
   */
  _mapContact(phoneJid, lidJid) {
    const phone = phoneJid.replace(/:.*@/, '@')
    const lid = lidJid.replace(/:.*@/, '@')
    this.lidToPhone.set(lid, phone)
    this.phoneToLid.set(phone, lid)
  }

  /**
   * Check if a chatId is in the allowedDMs list.
   * Handles LID<->phone translation.
   */
  _isAllowedDM(chatId, allowedDMs) {
    if (allowedDMs.includes('*')) return true
    if (allowedDMs.includes(chatId)) return true
    const alt = this.lidToPhone.get(chatId) || this.phoneToLid.get(chatId)
    if (alt && allowedDMs.includes(alt)) return true
    return false
  }

  /**
   * Activate self-chat session with 30 minute inactivity timeout
   */
  _activateSelfChat(jid) {
    this.activeSelfChatSessions.add(jid)
    // Reset the inactivity timer
    if (this.selfChatTimers.has(jid)) {
      clearTimeout(this.selfChatTimers.get(jid))
    }
    this.selfChatTimers.set(jid, setTimeout(() => {
      this.activeSelfChatSessions.delete(jid)
      this.selfChatTimers.delete(jid)
      console.log(`[WhatsApp] Self-chat session expired (30min inactivity)`)
    }, 30 * 60 * 1000))
  }

  /**
   * Deactivate self-chat session (called by /new command)
   */
  deactivateSelfChat(jid) {
    this.activeSelfChatSessions.delete(jid)
    if (this.selfChatTimers.has(jid)) {
      clearTimeout(this.selfChatTimers.get(jid))
      this.selfChatTimers.delete(jid)
    }
  }

  /**
   * Check if text starts with an Atlas trigger and return the stripped text
   * Returns { triggered: boolean, text: string }
   */
  _checkAtlasTrigger(text) {
    const lower = text.trim().toLowerCase()
    for (const trigger of this.teamTriggers) {
      if (lower.startsWith(trigger)) {
        return { triggered: true, text: text.trim().slice(trigger.length).trim() }
      }
    }
    return { triggered: false, text }
  }

  /**
   * Activate team member session with 30 minute inactivity timeout
   */
  _activateTeamSession(jid) {
    this.activeTeamSessions.add(jid)
    if (this.teamSessionTimers.has(jid)) {
      clearTimeout(this.teamSessionTimers.get(jid))
    }
    this.teamSessionTimers.set(jid, setTimeout(() => {
      this.activeTeamSessions.delete(jid)
      this.teamSessionTimers.delete(jid)
      console.log(`[WhatsApp] Team session expired for ${jid} (30min inactivity)`)
    }, 30 * 60 * 1000))
  }

  /**
   * Deactivate team session
   */
  deactivateTeamSession(jid) {
    this.activeTeamSessions.delete(jid)
    if (this.teamSessionTimers.has(jid)) {
      clearTimeout(this.teamSessionTimers.get(jid))
      this.teamSessionTimers.delete(jid)
    }
  }

  /**
   * Self-chat prefixes — any of these activate CC mode
   */
  get selfChatPrefixes() {
    return ['cc,', 'cc ', 'cc.', 'hey cc,', 'hey cc ', 'atlas,', 'atlas ', 'hey atlas,', 'hey atlas ']
  }

  /**
   * Check if this is a self-chat message (from Frank's own number with CC prefix)
   */
  _isSelfChat(msg, text) {
    if (!msg.key.fromMe) return false
    const lower = text.trim().toLowerCase()
    return this.selfChatPrefixes.some(p => lower.startsWith(p))
  }

  /**
   * Strip the self-chat prefix from the message text
   */
  _stripSelfChatPrefix(text) {
    const lower = text.trim().toLowerCase()
    for (const prefix of this.selfChatPrefixes) {
      if (lower.startsWith(prefix)) {
        return text.trim().slice(prefix.length).trim()
      }
    }
    return text.trim()
  }

  async handleMessage(msg) {
    const jid = msg.key.remoteJid
    const isGroup = jid?.endsWith('@g.us')

    // Extract text early for self-chat detection
    let text = msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      msg.message?.videoMessage?.caption ||
      ''

    // Handle self-chat (fromMe messages)
    if (msg.key.fromMe) {
      // Filter out our own bot replies echoing back
      if (this.sentMessageIds.has(msg.key.id)) {
        this.sentMessageIds.delete(msg.key.id)
        return
      }

      if (!isGroup) {
        // Check if "CC," prefix activates the session
        if (this._isSelfChat(msg, text)) {
          text = this._stripSelfChatPrefix(text)
          this._activateSelfChat(jid)
          console.log(`[WhatsApp] Self-chat activated, stripped prefix: "${text.substring(0, 50)}"`)
        } else if (this.activeSelfChatSessions.has(jid)) {
          // Session already active — no prefix needed, refresh timeout
          this._activateSelfChat(jid)
          console.log(`[WhatsApp] Self-chat (active session): "${text.substring(0, 50)}"`)
        } else {
          // No active session and no prefix — ignore (Frank's regular WhatsApp usage)
          return
        }
      } else {
        return
      }
    }

    const sender = isGroup ? msg.key.participant : jid

    // Team member DMs (not fromMe — anyone texting Frank's number with "Atlas" trigger)
    // This runs BEFORE the allowlist check so any number can use Atlas
    if (!msg.key.fromMe && !isGroup) {
      const atlas = this._checkAtlasTrigger(text)
      if (atlas.triggered) {
        text = atlas.text
        this._activateTeamSession(jid)
        console.log(`[WhatsApp] Atlas session activated for ${jid}: "${text.substring(0, 50)}"`)
      } else if (this.activeTeamSessions.has(jid)) {
        // Session already active — no prefix needed, refresh timeout
        this._activateTeamSession(jid)
        console.log(`[WhatsApp] Atlas session (active) from ${jid}: "${text.substring(0, 50)}"`)
      } else {
        // Not an Atlas message and no active session — ignore (normal DM to Frank)
        return
      }
      // Skip the allowlist check below — Atlas trigger is the gatekeeper
    } else if (!isGroup && !msg.key.fromMe) {
      // Should not reach here, but safety net
      return
    }

    // Group bail-out (keep allowlist for groups)
    if (isGroup) {
      if (this.config.allowedGroups.length === 0) return
      if (!this.config.allowedGroups.includes('*') && !this.config.allowedGroups.includes(jid)) return
    }

    // Extract mentions (needed for group mention-gating)
    const mentions = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || []
    const myNumber = this.myJid?.split('@')[0]?.split(':')[0]
    const myLidNumber = this.myLid?.split('@')[0]?.split(':')[0]
    const isMentioned = mentions.some(m => {
      const mBase = m.split('@')[0]?.split(':')[0]
      return (myNumber && mBase === myNumber) || (myLidNumber && mBase === myLidNumber)
    })

    // Group mention-only gating
    if (isGroup && this.config.respondToMentionsOnly && !isMentioned) {
      return
    }

    // Check for image (only after passing security checks)
    let image = null
    if (msg.message?.imageMessage) {
      console.log('[WhatsApp] Downloading image...')
      const buffer = await this.downloadImage(msg)
      if (buffer) {
        image = {
          data: buffer.toString('base64'),
          mediaType: 'image/jpeg'
        }
        console.log('[WhatsApp] Image downloaded, size:', buffer.length)
      }
      if (!text) {
        text = '[Image]'
      }
    }

    if (!text && !image) return

    this.emitMessage({
      chatId: jid,
      text,
      isGroup,
      sender,
      mentions: isMentioned ? ['self'] : mentions,
      image,
      raw: msg
    })
  }
}
