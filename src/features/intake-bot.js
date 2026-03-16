import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

/**
 * Client Intake Bot Feature
 * Captures leads from unknown WhatsApp contacts
 *
 * When an unknown person messages Atlas:
 *   - Ask: name, address, damage type, urgency
 *   - Create job in jobs.json (status: active)
 *   - Create Google Drive folder via gws
 *   - Alert Frank: "🆕 New lead: name, address, damage type"
 *
 * Commands:
 *   /intakes — list recent leads
 *
 * Reads/writes: /Users/ghost/Projects/cc-wag/workspace/jobs.json
 * Drive parent folder: 1QYQysnw8kYfwY14fgPgfAx5nlqlmfSxW
 */

const JOBS_FILE = '/Users/ghost/Projects/cc-wag/workspace/jobs.json'
const INTAKES_FILE = '/Users/ghost/Projects/cc-wag/workspace/intakes.json'
const FRANK_CHAT_ID = '17034981581@s.whatsapp.net'
const GWS_PATH = '/opt/homebrew/bin/gws'
const DRIVE_PARENT_FOLDER = '1QYQysnw8kYfwY14fgPgfAx5nlqlmfSxW'
const LIEN_DEADLINE_DAYS = 90

// ── Storage ─────────────────────────────────────────────────────────

function loadJobsData() {
  try {
    if (!fs.existsSync(JOBS_FILE)) return { nextId: 1, jobs: [] }
    const raw = fs.readFileSync(JOBS_FILE, 'utf-8')
    const data = JSON.parse(raw)
    if (Array.isArray(data)) return { nextId: data.length + 1, jobs: data }
    return data
  } catch {
    return { nextId: 1, jobs: [] }
  }
}

function saveJobsData(data) {
  const dir = path.dirname(JOBS_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(JOBS_FILE, JSON.stringify(data, null, 2))
}

function loadIntakes() {
  try {
    if (!fs.existsSync(INTAKES_FILE)) return []
    return JSON.parse(fs.readFileSync(INTAKES_FILE, 'utf-8'))
  } catch {
    return []
  }
}

function saveIntakes(intakes) {
  const dir = path.dirname(INTAKES_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(INTAKES_FILE, JSON.stringify(intakes, null, 2))
}

// ── Helpers ─────────────────────────────────────────────────────────

function makeJobId(num) {
  return `FD-${String(num).padStart(3, '0')}`
}

function addDays(date, days) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d.toISOString()
}

function formatDate(isoStr) {
  if (!isoStr) return '—'
  return new Date(isoStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
  })
}

function isBusinessHours() {
  const hour = new Date().getHours()
  // Frank's schedule: awake 10am-5am. Alerts OK from 10am to 5am.
  // No alerts 5am-10am
  return hour >= 10 || hour < 5
}

// ── Intake Session Manager ──────────────────────────────────────────

// Track active intake conversations by chat ID
// Each session stores collected info and conversation step
const activeSessions = new Map()

const INTAKE_STEPS = [
  {
    key: 'name',
    question: '👋 Hi! I\'m Atlas, the assistant for Flood Doctor. I can help get you started.\n\nWhat\'s your name?',
    validate: (v) => v.trim().length >= 2,
    error: 'Please provide your full name.'
  },
  {
    key: 'address',
    question: 'Thanks! What\'s the property address where the damage occurred?',
    validate: (v) => v.trim().length >= 5,
    error: 'Please provide the full street address.'
  },
  {
    key: 'damageType',
    question: 'What type of damage are you dealing with?\n\n1. Water damage / flooding\n2. Mold\n3. Fire / smoke\n4. Sewage backup\n5. Storm damage\n6. Other\n\nReply with a number or describe it.',
    validate: () => true,
    transform: (v) => {
      const types = {
        '1': 'Water damage / flooding',
        '2': 'Mold',
        '3': 'Fire / smoke',
        '4': 'Sewage backup',
        '5': 'Storm damage',
        '6': 'Other'
      }
      return types[v.trim()] || v.trim()
    }
  },
  {
    key: 'urgency',
    question: 'How urgent is this?\n\n1. 🚨 Emergency — active flooding/damage now\n2. ⚡ Urgent — needs attention within 24h\n3. 📋 Standard — can schedule this week\n\nReply 1, 2, or 3.',
    validate: (v) => ['1', '2', '3'].includes(v.trim()),
    transform: (v) => {
      const levels = { '1': 'emergency', '2': 'urgent', '3': 'standard' }
      return levels[v.trim()] || 'standard'
    },
    error: 'Please reply 1, 2, or 3.'
  }
]

// ── Create Job from Intake ──────────────────────────────────────────

function createJobFromIntake(session) {
  const data = loadJobsData()
  const now = new Date().toISOString()
  const jobId = makeJobId(data.nextId)

  // Parse city from address (last part after comma)
  const addrParts = session.address.split(',')
  const city = addrParts.length > 1 ? addrParts[addrParts.length - 1].trim() : ''
  const address = addrParts.length > 1 ? addrParts.slice(0, -1).join(',').trim() : session.address

  const job = {
    id: jobId,
    client: session.name,
    address,
    city,
    status: 'active',
    dateCreated: now,
    dateCompleted: null,
    invoiceAmount: null,
    invoiceDate: null,
    paymentDate: null,
    adjuster: null,
    adjusterEmail: null,
    notes: [
      `Intake via WhatsApp from ${session.chatId}`,
      `Damage type: ${session.damageType}`,
      `Urgency: ${session.urgency}`
    ],
    lienDeadline: addDays(now, LIEN_DEADLINE_DAYS),
    intakeSource: 'whatsapp',
    intakeDate: now,
    intakeChatId: session.chatId,
    damageType: session.damageType,
    urgency: session.urgency
  }

  data.jobs.push(job)
  data.nextId++
  saveJobsData(data)

  return job
}

// ── Create Drive Folder ─────────────────────────────────────────────

function createDriveFolder(jobId, clientName) {
  const folderName = `${jobId.replace('FD-0', '').replace('FD-', '')} - ${clientName}`

  try {
    const params = JSON.stringify({
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [DRIVE_PARENT_FOLDER]
    })

    const result = execSync(
      `${GWS_PATH} drive files create --params '${params}'`,
      { encoding: 'utf-8', timeout: 15000 }
    )

    // Try to parse folder ID from response
    let folderId = null
    try {
      const parsed = JSON.parse(result)
      folderId = parsed.id || parsed.fileId || null
    } catch {
      // Try to extract ID from text output
      const idMatch = result.match(/id[:\s]+"?([a-zA-Z0-9_-]{20,})"?/i)
      if (idMatch) folderId = idMatch[1]
    }

    console.log(`[IntakeBot] Drive folder created: ${folderName}${folderId ? ` (${folderId})` : ''}`)
    return { success: true, folderId, folderName }
  } catch (err) {
    console.error(`[IntakeBot] Drive folder creation failed: ${err.message}`)
    return { success: false, error: err.message }
  }
}

// ── Alert Frank ─────────────────────────────────────────────────────

async function alertFrank(gateway, session, jobId) {
  if (!isBusinessHours()) {
    console.log('[IntakeBot] Outside business hours, queuing alert for later')
    // Still log it, Frank will see it when he checks /intakes
    return
  }

  const urgencyEmoji = {
    'emergency': '🚨',
    'urgent': '⚡',
    'standard': '📋'
  }

  const emoji = urgencyEmoji[session.urgency] || '📋'
  const lines = [
    `🆕 *New Lead via WhatsApp*`,
    '',
    `${emoji} *${session.urgency.toUpperCase()}*`,
    `Name: ${session.name}`,
    `Address: ${session.address}`,
    `Damage: ${session.damageType}`,
    `Job: *${jobId}*`,
    '',
    `Source: WhatsApp (${session.chatId.split('@')[0]})`,
    `Time: ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
  ]

  const adapter = gateway.adapters.get('whatsapp')
  if (adapter) {
    try {
      await adapter.sendMessage(FRANK_CHAT_ID, lines.join('\n'))
      console.log(`[IntakeBot] Alert sent to Frank for ${session.name}`)
    } catch (err) {
      console.error(`[IntakeBot] Failed to alert Frank: ${err.message}`)
    }
  }
}

// ── Process Intake Message ──────────────────────────────────────────

async function processIntakeMessage(gateway, chatId, text, adapter) {
  let session = activeSessions.get(chatId)

  // Start new intake session
  if (!session) {
    session = {
      chatId,
      step: 0,
      name: null,
      address: null,
      damageType: null,
      urgency: null,
      startedAt: new Date().toISOString()
    }
    activeSessions.set(chatId, session)

    // Send first question
    const firstStep = INTAKE_STEPS[0]
    await adapter.sendMessage(chatId, firstStep.question)
    return { handled: true }
  }

  // Process answer for current step
  const currentStep = INTAKE_STEPS[session.step]

  // Validate answer
  if (!currentStep.validate(text)) {
    await adapter.sendMessage(chatId, currentStep.error || 'Please try again.')
    return { handled: true }
  }

  // Store answer (with optional transform)
  const value = currentStep.transform ? currentStep.transform(text) : text.trim()
  session[currentStep.key] = value
  session.step++

  // If more steps, ask next question
  if (session.step < INTAKE_STEPS.length) {
    const nextStep = INTAKE_STEPS[session.step]
    await adapter.sendMessage(chatId, nextStep.question)
    return { handled: true }
  }

  // All steps complete — create job
  activeSessions.delete(chatId)

  // Create job in jobs.json
  const job = createJobFromIntake(session)

  // Create Drive folder
  const driveResult = createDriveFolder(job.id, session.name)

  // Update job with Drive info if successful
  if (driveResult.success && driveResult.folderId) {
    const data = loadJobsData()
    const savedJob = data.jobs.find(j => j.id === job.id)
    if (savedJob) {
      savedJob.driveFolderId = driveResult.folderId
      savedJob.driveUrl = `https://drive.google.com/drive/folders/${driveResult.folderId}`
      saveJobsData(data)
    }
  }

  // Save to intakes log
  const intakes = loadIntakes()
  intakes.push({
    jobId: job.id,
    name: session.name,
    address: session.address,
    damageType: session.damageType,
    urgency: session.urgency,
    chatId: session.chatId,
    timestamp: new Date().toISOString(),
    driveFolder: driveResult.success ? driveResult.folderName : null
  })
  saveIntakes(intakes)

  // Alert Frank
  await alertFrank(gateway, session, job.id)

  // Confirm to the lead
  const urgencyResponse = {
    'emergency': 'We understand this is an emergency. Frank will reach out to you very shortly.',
    'urgent': 'We\'ve marked this as urgent. Frank will contact you within a few hours.',
    'standard': 'Frank will review your request and contact you to schedule.'
  }

  const confirmLines = [
    `✅ *Thank you, ${session.name}!*`,
    '',
    `Your request has been logged as job *${job.id}*.`,
    '',
    urgencyResponse[session.urgency] || urgencyResponse.standard,
    '',
    'Flood Doctor LLC',
    'frank@flood.doctor',
    '(703) 498-1581'
  ]

  await adapter.sendMessage(chatId, confirmLines.join('\n'))
  return { handled: true }
}

// ── /intakes — list recent leads ────────────────────────────────────

function handleIntakesList() {
  const intakes = loadIntakes()

  if (intakes.length === 0) {
    return { handled: true, response: 'No intakes recorded yet.' }
  }

  // Show most recent first, limit 15
  const recent = intakes.slice(-15).reverse()

  const lines = [
    `🆕 *Recent Intakes* (${intakes.length} total, showing last ${recent.length})`,
    ''
  ]

  for (const i of recent) {
    const urgencyEmoji = { 'emergency': '🚨', 'urgent': '⚡', 'standard': '📋' }
    const emoji = urgencyEmoji[i.urgency] || '📋'
    const date = formatDate(i.timestamp)
    const phone = i.chatId ? i.chatId.split('@')[0] : '—'

    lines.push(`${emoji} *${i.jobId}* ${i.name} — ${date}`)
    lines.push(`   ${i.address}`)
    lines.push(`   Damage: ${i.damageType} | Phone: ${phone}`)
    lines.push('')
  }

  return { handled: true, response: lines.join('\n').trim() }
}

// ── Command Router ──────────────────────────────────────────────────

function routeIntakeCommand(text) {
  const lower = text.trim().toLowerCase()

  if (lower === '/intakes') return handleIntakesList()

  return null
}

// ── Known Chat IDs (not leads) ──────────────────────────────────────
// These are Frank or known team members — skip intake flow

const KNOWN_CHATS = new Set([
  FRANK_CHAT_ID,
  '174796696477830@lid',       // Frank's LID (self-chat comes in as LID)
  '12024598844@s.whatsapp.net', // Shyon
  '49886229692465@lid',         // Shyon LID
])

// ── Plugin Registration ─────────────────────────────────────────────

export function register(gateway) {
  // Ensure workspace directory
  const dir = path.dirname(INTAKES_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  // Intercept /intakes command
  const originalExecute = gateway.commandHandler.execute.bind(gateway.commandHandler)

  gateway.commandHandler.execute = async function (text, sessionKey, adapter, chatId) {
    const lower = text.trim().toLowerCase()

    if (lower === '/intakes') {
      const result = routeIntakeCommand(text)
      if (result) return result
    }

    return originalExecute(text, sessionKey, adapter, chatId)
  }

  // Intercept unknown contacts at the adapter level
  // We hook into the gateway's message processing by wrapping setupAdapter
  // Instead, we add a pre-processor to the command handler that checks for unknown contacts
  const originalAdapterExecute = gateway.commandHandler.execute.bind(gateway.commandHandler)

  gateway.commandHandler.execute = async function (text, sessionKey, adapter, chatId) {
    // Check if this is an active intake session
    if (activeSessions.has(chatId)) {
      return processIntakeMessage(gateway, chatId, text, adapter)
    }

    // Check if this is from an unknown contact (not Frank, not a group, not a command)
    if (
      chatId &&
      !KNOWN_CHATS.has(chatId) &&
      !chatId.endsWith('@g.us') && // not a group
      !text.trim().startsWith('/') && // not a command
      !sessionKey.includes(':dm:174796696477830@lid') // not Frank self-chat via LID
    ) {
      // Check if this person has messaged before (has a session)
      // If it's their first message and they're not known, start intake
      const hasExistingSession = gateway.agentRunner?.agent?.sessions?.has(sessionKey)

      if (!hasExistingSession) {
        return processIntakeMessage(gateway, chatId, text, adapter)
      }
    }

    return originalAdapterExecute(text, sessionKey, adapter, chatId)
  }

  // Extend /help
  const originalHelp = gateway.commandHandler.handleHelp.bind(gateway.commandHandler)
  gateway.commandHandler.handleHelp = function () {
    const result = originalHelp()
    const intakeLines = [
      '',
      '--- Intake Bot ---',
      '/intakes — list recent leads',
      '(Auto-triggers for unknown WhatsApp contacts)'
    ]
    result.response += '\n' + intakeLines.join('\n')
    return result
  }

  console.log('[IntakeBot] Loaded — intake flow for unknown contacts + /intakes command')
}
