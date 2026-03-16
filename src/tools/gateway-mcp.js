import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

/**
 * Gateway context - set by gateway before agent runs
 */
let gatewayContext = {
  gateway: null,
  currentPlatform: null,
  currentChatId: null,
  currentSessionKey: null
}

export function setGatewayContext(ctx) {
  gatewayContext = { ...gatewayContext, ...ctx }
}

export function getGatewayContext() {
  return gatewayContext
}

/**
 * Create Gateway MCP server with tools for interacting with the gateway
 */
export function createGatewayMcpServer() {
  return createSdkMcpServer({
    name: 'gateway',
    version: '1.0.0',
    tools: [
      tool(
        'send_whatsapp',
        'Send a WhatsApp message to a specific chat. Shortcut for send_message with WhatsApp platform.',
        {
          chat_id: z.string().describe('The chat ID (e.g., +1234567890@s.whatsapp.net or group JID)'),
          message: z.string().describe('The message text to send')
        },
        async ({ chat_id, message }) => {
          const { gateway } = gatewayContext
          if (!gateway) {
            return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Gateway not available' }) }] }
          }

          const adapter = gateway.adapters.get('whatsapp')
          if (!adapter) {
            return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'WhatsApp not connected' }) }] }
          }

          try {
            await adapter.sendMessage(chat_id, message)
            return { content: [{ type: 'text', text: JSON.stringify({ success: true, platform: 'whatsapp', chat_id, message_length: message.length }) }] }
          } catch (err) {
            return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: err.message }) }] }
          }
        }
      ),

      tool(
        'send_message',
        'Send a message to a specific chat on WhatsApp.',
        {
          chat_id: z.string().describe('The chat ID to send to (e.g., phone@s.whatsapp.net for WhatsApp)'),
          message: z.string().describe('The message text to send')
        },
        async ({ chat_id, message }) => {
          const { gateway } = gatewayContext
          if (!gateway) {
            return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Gateway not available' }) }] }
          }

          const adapter = gateway.adapters.get('whatsapp')
          if (!adapter) {
            return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'WhatsApp not connected' }) }] }
          }

          try {
            await adapter.sendMessage(chat_id, message)
            return { content: [{ type: 'text', text: JSON.stringify({ success: true, platform: 'whatsapp', chat_id, message_length: message.length }) }] }
          } catch (err) {
            return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: err.message }) }] }
          }
        }
      ),

      tool(
        'list_platforms',
        'List all connected messaging platforms and their status',
        {},
        async () => {
          const { gateway } = gatewayContext
          if (!gateway) {
            return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Gateway not available' }) }] }
          }

          const platforms = []
          for (const [name, adapter] of gateway.adapters) {
            platforms.push({
              name,
              connected: !!adapter.sock
            })
          }

          return { content: [{ type: 'text', text: JSON.stringify({ success: true, platforms }) }] }
        }
      ),

      tool(
        'get_queue_status',
        'Get the current queue status for all sessions or a specific session',
        {
          session_key: z.string().optional().describe('Optional session key to check specific session')
        },
        async ({ session_key }) => {
          const { gateway } = gatewayContext
          if (!gateway) {
            return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Gateway not available' }) }] }
          }

          if (session_key) {
            const status = gateway.agentRunner.getQueueStatus(session_key)
            return { content: [{ type: 'text', text: JSON.stringify({ success: true, session: session_key, ...status }) }] }
          }

          const globalStats = gateway.agentRunner.getGlobalStats()
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, ...globalStats }) }] }
        }
      ),

      tool(
        'get_current_context',
        'Get information about the current conversation context (platform, chat, session)',
        {},
        async () => {
          const { currentPlatform, currentChatId, currentSessionKey } = gatewayContext
          return {
            content: [{ type: 'text', text: JSON.stringify({
              success: true,
              platform: currentPlatform,
              chat_id: currentChatId,
              session_key: currentSessionKey
            }) }]
          }
        }
      ),

      tool(
        'list_sessions',
        'List all active sessions with their last activity time',
        {},
        async () => {
          const { gateway } = gatewayContext
          if (!gateway) {
            return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Gateway not available' }) }] }
          }

          const sessions = []
          for (const [key, data] of gateway.agentRunner.agent.sessions) {
            sessions.push({
              key,
              message_count: data.messageCount,
              last_activity: new Date(data.lastActivity).toISOString(),
              created: new Date(data.createdAt).toISOString()
            })
          }

          return { content: [{ type: 'text', text: JSON.stringify({ success: true, sessions, count: sessions.length }) }] }
        }
      ),

      tool(
        'broadcast_message',
        'Send a message to multiple WhatsApp chats. Use with caution.',
        {
          targets: z.array(z.object({
            chat_id: z.string()
          })).describe('Array of WhatsApp chat targets to send to'),
          message: z.string().describe('The message to broadcast')
        },
        async ({ targets, message }) => {
          const { gateway } = gatewayContext
          if (!gateway) {
            return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Gateway not available' }) }] }
          }

          const adapter = gateway.adapters.get('whatsapp')
          if (!adapter) {
            return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'WhatsApp not connected' }) }] }
          }

          const results = []
          for (const target of targets) {
            try {
              await adapter.sendMessage(target.chat_id, message)
              results.push({ chat_id: target.chat_id, success: true })
            } catch (err) {
              results.push({ chat_id: target.chat_id, success: false, error: err.message })
            }
          }

          const successful = results.filter(r => r.success).length
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, sent: successful, failed: results.length - successful, results }) }] }
        }
      )
    ]
  })
}
