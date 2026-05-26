const SECRET_KEYS = new Set([
  'apikey', 'api_key', 'token', 'authtoken', 'auth_token',
  'accesstoken', 'access_token', 'refreshtoken', 'refresh_token',
  'authorization', 'bearer', 'password', 'secret',
  'clientsecret', 'client_secret', 'gatewaytoken', 'gateway_token',
  'twilioauthtoken', 'twilio_auth_token',
  'companycamapitoken', 'companycam_api_token',
  'anthropicapikey', 'anthropic_api_key',
  'twilio_api_key_secret', 'twilioapikeysecret',
  'companycam_webhook_secret', 'companycamwebhooksecret',
  'gateway_api_token', 'gatewayapitoken',
  'join_api_key', 'joinapikey',
  'location_secret', 'locationsecret',
])

export function maskValue(val) {
  if (val == null) return ''
  const str = String(val)
  if (str.length === 0) return ''
  if (str.length <= 8) return '****'
  return str.slice(0, 4) + '****' + str.slice(-4)
}

export function maskObject(obj) {
  if (obj == null || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(maskObject)

  const masked = {}
  for (const [key, value] of Object.entries(obj)) {
    const normalised = key.toLowerCase().replace(/[-\s]/g, '')
    if (SECRET_KEYS.has(normalised) && typeof value === 'string') {
      masked[key] = maskValue(value)
    } else if (typeof value === 'object' && value !== null) {
      masked[key] = maskObject(value)
    } else {
      masked[key] = value
    }
  }
  return masked
}

export function isSecretKey(key) {
  return SECRET_KEYS.has(key.toLowerCase().replace(/[-\s]/g, ''))
}

const SECRET_PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{10,}/g,
  /AC[0-9a-f]{32}/g,
  /SK[0-9a-f]{32}/g,
  /Bearer\s+[A-Za-z0-9_.~+/=-]{20,}/g,
  /apikey=[^&\s]{8,}/gi,
]

export function scrubSecrets(str) {
  if (typeof str !== 'string') return str == null ? '' : String(str)
  let out = str
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0
    out = out.replace(pattern, match => maskValue(match))
  }
  return out
}
