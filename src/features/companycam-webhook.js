import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

/**
 * CompanyCam Webhook Listener
 * Receives real-time photo upload events from CompanyCam and notifies Frank.
 *
 * Endpoint: POST /webhook/companycam
 * Events: photo.created, document.created
 * Auth: HMAC-SHA1 signature via X-CompanyCam-Signature header
 *
 * Stores events in workspace/companycam-events.jsonl
 * Matches photos to jobs by project name -> client name lookup
 *
 * CompanyCam Webhook API:
 *   POST /v2/webhooks to register
 *   Signature: HMAC-SHA1(body, secret) -> X-CompanyCam-Signature
 *
 * Requires: COMPANYCAM_API_TOKEN, COMPANYCAM_WEBHOOK_SECRET in .env
 */

const EVENTS_FILE = '/Users/ghost/Projects/cc-wag/workspace/companycam-events.jsonl'
const JOBS_FILE = '/Users/ghost/Projects/cc-wag/workspace/jobs.json'
const FRANK_CHAT_ID = '17034981581@s.whatsapp.net'

// ── Storage ─────────────────────────────────────────────────────────

function loadJobs() {
  try {
    if (fs.existsSync(JOBS_FILE)) {
      return JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'))
    }
  } catch (err) {
    console.error('[CC-Webhook] Failed to load jobs:', err.message)
  }
  return { nextId: 1, jobs: [] }
}

function appendEvent(event) {
  const dir = path.dirname(EVENTS_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const line = JSON.stringify({
    ...event,
    receivedAt: new Date().toISOString()
  })
  fs.appendFileSync(EVENTS_FILE, line + '\n')
}

// ── Signature Validation ────────────────────────────────────────────

function validateSignature(body, signature, secret) {
  if (!secret) {
    // No secret configured — skip validation but log warning
    console.warn('[CC-Webhook] No COMPANYCAM_WEBHOOK_SECRET set — skipping signature validation')
    return true
  }
  if (!signature) return false

  const expected = crypto
    .createHmac('sha1', secret)
    .update(body)
    .digest('hex')

  // Timing-safe comparison
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    )
  } catch {
    return false
  }
}

// ── Job Matching ────────────────────────────────────────────────────

/**
 * Try to match a CompanyCam project name to a tracked job
 * CompanyCam project names often contain client name or address
 */
function matchProjectToJob(projectName) {
  if (!projectName) return null

  const data = loadJobs()
  const lower = projectName.toLowerCase()

  // Try matching client name (partial match)
  for (const job of data.jobs) {
    if (!job.client) continue
    const clientLower = job.client.toLowerCase()

    // Check if client name appears in project name or vice versa
    if (lower.includes(clientLower) || clientLower.includes(lower)) {
      return job
    }

    // Try last name match (e.g., "Wigenton" in "David Wigenton Restoration")
    const lastName = job.client.split(' ').pop().toLowerCase()
    if (lastName.length >= 3 && lower.includes(lastName)) {
      return job
    }
  }

  // Try matching address
  for (const job of data.jobs) {
    if (!job.address) continue
    const addrLower = job.address.toLowerCase()
    if (addrLower.length >= 5 && lower.includes(addrLower)) {
      return job
    }
  }

  return null
}

// ── Event Handlers ──────────────────────────────────────────────────

function handlePhotoCreated(payload) {
  const photo = payload.resource || payload.data || payload
  const projectName = photo.project?.name || payload.project?.name || 'Unknown project'
  const creator = photo.creator?.name || photo.creator_name || 'Unknown tech'
  const photoUrl = photo.uris?.original_url || photo.uris?.photo_url || null
  const capturedAt = photo.captured_at
    ? new Date(photo.captured_at * 1000).toLocaleString('en-US')
    : 'unknown time'

  // Try to match to a job
  const job = matchProjectToJob(projectName)
  const jobInfo = job ? ` (matched: ${job.id} - ${job.client})` : ''

  // Build notification
  const lines = [
    `NEW PHOTO UPLOADED`,
    `Project: ${projectName}${jobInfo}`,
    `Tech: ${creator}`,
    `Time: ${capturedAt}`
  ]

  if (photoUrl) {
    lines.push(`Photo: ${photoUrl}`)
  }

  return {
    notification: lines.join('\n'),
    matchedJob: job,
    projectName,
    creator
  }
}

function handleDocumentCreated(payload) {
  const doc = payload.resource || payload.data || payload
  const projectName = doc.project?.name || payload.project?.name || 'Unknown project'
  const creator = doc.creator?.name || doc.creator_name || 'Unknown'

  const job = matchProjectToJob(projectName)
  const jobInfo = job ? ` (matched: ${job.id} - ${job.client})` : ''

  return {
    notification: [
      `NEW DOCUMENT UPLOADED`,
      `Project: ${projectName}${jobInfo}`,
      `By: ${creator}`
    ].join('\n'),
    matchedJob: job,
    projectName,
    creator
  }
}

// ── HTTP Handler ────────────────────────────────────────────────────

function createWebhookHandler(gateway) {
  return async (req, res) => {
    // Only accept POST
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Method not allowed' }))
      return
    }

    // Read body
    let body = ''
    await new Promise((resolve) => {
      req.on('data', chunk => { body += chunk })
      req.on('end', resolve)
    })

    // Validate signature
    const signature = req.headers['x-companycam-signature']
    const secret = process.env.COMPANYCAM_WEBHOOK_SECRET

    if (!validateSignature(body, signature, secret)) {
      console.warn('[CC-Webhook] Invalid signature — rejecting')
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Invalid signature' }))
      return
    }

    // Parse payload
    let payload
    try {
      payload = JSON.parse(body)
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Invalid JSON' }))
      return
    }

    const eventType = payload.event || payload.type || 'unknown'

    // Log the raw event
    appendEvent({ event: eventType, payload })
    console.log(`[CC-Webhook] Received event: ${eventType}`)

    // Respond immediately (CompanyCam expects 200 quickly)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ received: true, event: eventType }))

    // Process the event asynchronously
    try {
      let result = null

      if (eventType === 'photo.created') {
        result = handlePhotoCreated(payload)
      } else if (eventType === 'document.created') {
        result = handleDocumentCreated(payload)
      } else {
        console.log(`[CC-Webhook] Ignoring unhandled event: ${eventType}`)
        return
      }

      if (!result) return

      // Notify Frank via WhatsApp
      const adapter = gateway.adapters.get('whatsapp')
      if (adapter) {
        await adapter.sendMessage(FRANK_CHAT_ID, result.notification)
        console.log(`[CC-Webhook] Notified Frank: ${eventType} from ${result.creator} on ${result.projectName}`)
      }
    } catch (err) {
      console.error(`[CC-Webhook] Error processing ${eventType}:`, err.message)
    }
  }
}

// ── Plugin Registration ─────────────────────────────────────────────

export function register(gateway) {
  const webhookHandler = createWebhookHandler(gateway)

  // Register the webhook route on the HTTP server
  // We intercept the existing httpServer request handler
  const originalListenerSetup = gateway.startHttpServer.bind(gateway)

  // Store our handler so it can be called from the HTTP server
  gateway._companycamWebhookHandler = webhookHandler

  // Patch the HTTP server creation to add our route
  // We need to hook into the existing server since it's created in startHttpServer
  const originalStart = gateway.start.bind(gateway)
  const patchApplied = { value: false }

  // Use an interval to wait for the HTTP server to be created
  const patchTimer = setInterval(() => {
    if (gateway.httpServer && !patchApplied.value) {
      patchApplied.value = true
      clearInterval(patchTimer)

      // Get existing listeners and add our route
      const existingListeners = gateway.httpServer.listeners('request')
      if (existingListeners.length > 0) {
        const originalHandler = existingListeners[0]

        // Remove the existing handler and add our wrapper
        gateway.httpServer.removeAllListeners('request')
        gateway.httpServer.on('request', async (req, res) => {
          // Intercept our webhook path
          if (req.url === '/webhook/companycam') {
            return webhookHandler(req, res)
          }
          // Everything else goes to the original handler
          return originalHandler(req, res)
        })

        console.log('[CC-Webhook] Route registered: POST /webhook/companycam')
      }
    }
  }, 500)

  // Clean up timer after 30s if server never appears
  setTimeout(() => clearInterval(patchTimer), 30000)

  const hasToken = !!process.env.COMPANYCAM_API_TOKEN
  const hasSecret = !!process.env.COMPANYCAM_WEBHOOK_SECRET
  console.log(`[CC-Webhook] Loaded — POST /webhook/companycam${hasToken ? '' : ' (NO API TOKEN)'}${hasSecret ? '' : ' (NO WEBHOOK SECRET - signature validation disabled)'}`)
}
