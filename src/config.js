import 'dotenv/config'

const parseList = (env) => env ? env.split(',').map(s => s.trim()).filter(Boolean) : []

export default {
  agentId: 'cc-wag',

  whatsapp: {
    enabled: true,
    allowedDMs: parseList(process.env.WHATSAPP_ALLOWED_DMS),
    allowedGroups: parseList(process.env.WHATSAPP_ALLOWED_GROUPS),
    respondToMentionsOnly: true
  },

  // Self-chat mode: messages from Frank's own number starting with "CC," prefix
  selfChat: {
    prefix: 'CC,',
    frankPhone: process.env.FRANK_PHONE || '+17034981581'
  },

  // Agent configuration
  agent: {
    workspace: '/Users/ghost/Projects/cc-wag',
    maxTurns: 50,
    allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'TodoWrite', 'Skill'],
    provider: 'claude'
  },

  // Google Tasks list IDs (via gws CLI)
  googleTasks: {
    floodDoctor: 'WUlnZzdORlJwa01PTEFVSw',
    personal: 'NE1SZ0pXUF9hT2pVczFUQg'
  },

  // Gateway HTTP server
  gateway: {
    port: parseInt(process.env.GATEWAY_PORT || '4096', 10),
    apiToken: process.env.GATEWAY_API_TOKEN || ''
  },

  // Location sharing (on-demand via Tasker + Join)
  location: {
    secret: process.env.LOCATION_SECRET || '',
    joinApiKey: process.env.JOIN_API_KEY || '',
    joinDeviceId: process.env.JOIN_DEVICE_ID || '',
    timeoutMs: 30000
  }
}
