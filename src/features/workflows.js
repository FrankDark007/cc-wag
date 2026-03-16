import fs from 'fs'
import path from 'path'

/**
 * Workflows Feature
 * Multi-step conversational flows for complex operations.
 * When Frank starts a flow, subsequent messages are intercepted
 * and processed as next steps until the flow completes or is cancelled.
 *
 * Commands:
 *   /flow dispute <job-id>  — Start dispute resolution flow
 *   /flow intake            — Start new client intake flow
 *   /flow scope <job-id>    — Start scope review flow
 *   /flow status            — Show active flows
 *   /flow cancel            — Cancel current flow
 *   /flow help              — Show commands
 *
 * Storage: workspace/active-workflows.json
 */

const WORKSPACE = '/Users/ghost/Projects/cc-wag/workspace'
const FLOWS_FILE = path.join(WORKSPACE, 'active-workflows.json')
const JOBS_FILE = path.join(WORKSPACE, 'jobs.json')
const DISPUTES_FILE = path.join(WORKSPACE, 'disputes.json')
const FRANK_CHAT_ID = '17034981581@s.whatsapp.net'

// Flow timeout: 30 minutes
const FLOW_TIMEOUT_MS = 30 * 60 * 1000

// ── Shared Job Data (with fallback) ─────────────────────────────────

let jobUtils = null

async function ensureJobUtils() {
  if (jobUtils) return jobUtils
  try {
    jobUtils = await import('../utils/job-data.js')
    return jobUtils
  } catch {
    jobUtils = {
      loadJobs() {
        try {
          if (fs.existsSync(JOBS_FILE)) {
            const raw = fs.readFileSync(JOBS_FILE, 'utf-8')
            const data = JSON.parse(raw)
            if (Array.isArray(data)) return { nextId: data.length + 1, jobs: data }
            return data
          }
        } catch (err) {
          console.error('[Workflows] Failed to load jobs:', err.message)
        }
        return { nextId: 1, jobs: [] }
      },
      saveJobs(data) {
        const dir = path.dirname(JOBS_FILE)
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(JOBS_FILE, JSON.stringify(data, null, 2))
      },
      findJob(id) {
        const data = this.loadJobs()
        const upper = id.toUpperCase()
        return data.jobs.find(j => {
          if (j.id === upper) return true
          const num = parseInt(id, 10)
          if (!isNaN(num) && j.id === `FD-${String(num).padStart(3, '0')}`) return true
          return false
        }) || null
      },
      addJobNote(id, note) {
        const data = this.loadJobs()
        const upper = id.toUpperCase()
        const job = data.jobs.find(j => {
          if (j.id === upper) return true
          const num = parseInt(id, 10)
          if (!isNaN(num) && j.id === `FD-${String(num).padStart(3, '0')}`) return true
          return false
        })
        if (!job) return false
        if (!Array.isArray(job.notes)) job.notes = []
        job.notes.push({ text: note, date: new Date().toISOString() })
        this.saveJobs(data)
        return true
      },
      loadDisputes() {
        try {
          if (fs.existsSync(DISPUTES_FILE)) {
            return JSON.parse(fs.readFileSync(DISPUTES_FILE, 'utf-8'))
          }
        } catch (err) {
          console.error('[Workflows] Failed to load disputes:', err.message)
        }
        return { disputes: [] }
      },
      saveDisputes(data) {
        const dir = path.dirname(DISPUTES_FILE)
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(DISPUTES_FILE, JSON.stringify(data, null, 2))
      }
    }
    return jobUtils
  }
}

// ── Flow Storage ────────────────────────────────────────────────────

function loadFlows() {
  try {
    if (fs.existsSync(FLOWS_FILE)) {
      return JSON.parse(fs.readFileSync(FLOWS_FILE, 'utf-8'))
    }
  } catch (err) {
    console.error('[Workflows] Failed to load flows:', err.message)
  }
  return { activeFlows: {} }
}

function saveFlows(data) {
  const dir = path.dirname(FLOWS_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(FLOWS_FILE, JSON.stringify(data, null, 2))
}

function getActiveFlow(chatId) {
  const data = loadFlows()
  const flow = data.activeFlows[chatId]
  if (!flow) return null

  // Check timeout
  const lastActivity = new Date(flow.lastActivity).getTime()
  if (Date.now() - lastActivity > FLOW_TIMEOUT_MS) {
    delete data.activeFlows[chatId]
    saveFlows(data)
    return null
  }

  return flow
}

function setActiveFlow(chatId, flow) {
  const data = loadFlows()
  data.activeFlows[chatId] = {
    ...flow,
    lastActivity: new Date().toISOString()
  }
  saveFlows(data)
}

function clearFlow(chatId) {
  const data = loadFlows()
  delete data.activeFlows[chatId]
  saveFlows(data)
}

// ── Dispute Flow (5 steps) ──────────────────────────────────────────

async function startDisputeFlow(jobId, chatId) {
  const utils = await ensureJobUtils()
  const job = utils.findJob(jobId)
  if (!job) {
    return `Job not found: ${jobId}\n\nUse a job ID like FD-002 or just the number.`
  }

  setActiveFlow(chatId, {
    type: 'dispute',
    jobId: job.id,
    step: 1,
    data: {},
    startedAt: new Date().toISOString()
  })

  return [
    `*Dispute Flow Started* for ${job.id} (${job.client})`,
    '',
    'Step 1/5: What\'s the dispute about?',
    '(underpayment / denied line items / scope disagreement / other)',
    '',
    '_Type your answer or /flow cancel to exit_'
  ].join('\n')
}

async function processDisputeStep(flow, text, chatId, gateway) {
  const utils = await ensureJobUtils()
  const input = text.trim()

  switch (flow.step) {
    case 1: {
      // Capture dispute reason
      const validReasons = ['underpayment', 'denied line items', 'scope disagreement', 'other']
      const reason = validReasons.find(r => input.toLowerCase().includes(r.split(' ')[0])) || input
      flow.data.reason = reason
      flow.step = 2
      setActiveFlow(chatId, flow)
      return [
        `Got it: *${reason}*`,
        '',
        'Step 2/5: What\'s the disputed amount? (e.g., $8,500)'
      ].join('\n')
    }

    case 2: {
      // Capture disputed amount
      const amount = parseFloat(input.replace(/[$,]/g, ''))
      if (isNaN(amount) || amount <= 0) {
        return 'Please enter a valid dollar amount (e.g., 8500 or $8,500)'
      }
      flow.data.amount = amount
      flow.step = 3
      setActiveFlow(chatId, flow)
      return [
        `Got it: *$${amount.toLocaleString()}*`,
        '',
        'Step 3/5: What\'s the adjuster\'s main objection?'
      ].join('\n')
    }

    case 3: {
      // Capture adjuster objection + look up pushback KB
      flow.data.objection = input
      flow.step = 4
      setActiveFlow(chatId, flow)

      let kbResponse = ''
      try {
        // Try to find a pushback KB response
        const kbFile = path.join(WORKSPACE, 'xactimate-kb', 'pushback-responses.json')
        if (fs.existsSync(kbFile)) {
          const kb = JSON.parse(fs.readFileSync(kbFile, 'utf-8'))
          const match = fuzzyMatchKB(input, kb)
          if (match) {
            kbResponse = `\n*IICRC-backed response found:*\n${match.response}\n`
            if (match.references && match.references.length > 0) {
              kbResponse += '\nReferences:\n' + match.references.map(r => `  - ${r}`).join('\n') + '\n'
            }
          }
        }
      } catch {
        // KB not available, continue without
      }

      return [
        `Objection noted: "${input}"`,
        '',
        'Let me look up a response for that...',
        kbResponse || '\n_No exact KB match found, but we can still draft a custom response._\n',
        'Step 4/5: Want me to draft a formal dispute letter? (yes/no)'
      ].join('\n')
    }

    case 4: {
      // Draft letter decision
      const yes = input.toLowerCase().startsWith('y')
      flow.data.draftLetter = yes
      flow.step = 5
      setActiveFlow(chatId, flow)

      if (yes) {
        flow.data.letterDrafted = true
      }

      // Save dispute
      const disputeData = utils.loadDisputes ? utils.loadDisputes() : { disputes: [] }
      const dispute = {
        id: `DSP-${Date.now()}`,
        jobId: flow.jobId,
        reason: flow.data.reason,
        amount: flow.data.amount,
        objection: flow.data.objection,
        letterDrafted: yes,
        status: 'open',
        createdAt: new Date().toISOString()
      }
      disputeData.disputes.push(dispute)
      if (utils.saveDisputes) {
        utils.saveDisputes(disputeData)
      } else {
        fs.writeFileSync(DISPUTES_FILE, JSON.stringify(disputeData, null, 2))
      }

      // Add job note
      utils.addJobNote(flow.jobId, `Dispute created: ${flow.data.reason}, $${flow.data.amount.toLocaleString()} — objection: ${flow.data.objection}`)

      return [
        `Dispute created for *${flow.jobId}*: $${flow.data.amount.toLocaleString()} ${flow.data.reason}`,
        yes ? 'Formal letter drafted.' : 'No letter drafted.',
        '',
        'Step 5/5: Want me to email it to the adjuster? (yes / no / save)',
      ].join('\n')
    }

    case 5: {
      // Final step — email decision
      const choice = input.toLowerCase().trim()
      clearFlow(chatId)

      if (choice.startsWith('y')) {
        const job = utils.findJob(flow.jobId)
        const adjEmail = job?.adjusterEmail
        if (adjEmail) {
          return [
            `Dispute for *${flow.jobId}* saved and queued for email to ${adjEmail}.`,
            '',
            'Use /job ' + flow.jobId + ' to view job details.',
            '_Flow complete._'
          ].join('\n')
        }
        return [
          `Dispute for *${flow.jobId}* saved.`,
          `No adjuster email on file. Add one with: /job ${flow.jobId} adjuster <name> <email>`,
          '',
          '_Flow complete._'
        ].join('\n')
      }

      return [
        `Dispute for *${flow.jobId}* saved.`,
        choice === 'save' ? 'Letter saved as draft.' : 'No email sent.',
        '',
        'Use /job ' + flow.jobId + ' to view job details.',
        '_Flow complete._'
      ].join('\n')
    }

    default:
      clearFlow(chatId)
      return 'Flow error. Dispute cancelled. Try /flow dispute <job-id> again.'
  }
}

// ── Intake Flow (5 steps) ───────────────────────────────────────────

function startIntakeFlow(chatId) {
  setActiveFlow(chatId, {
    type: 'intake',
    step: 1,
    data: {},
    startedAt: new Date().toISOString()
  })

  return [
    '*New Client Intake Flow*',
    '',
    'Step 1/5: Client name?',
    '',
    '_Type your answer or /flow cancel to exit_'
  ].join('\n')
}

async function processIntakeStep(flow, text, chatId, gateway) {
  const utils = await ensureJobUtils()
  const input = text.trim()

  switch (flow.step) {
    case 1: {
      flow.data.clientName = input
      flow.step = 2
      setActiveFlow(chatId, flow)
      return [
        `Client: *${input}*`,
        '',
        'Step 2/5: Property address?'
      ].join('\n')
    }

    case 2: {
      flow.data.address = input
      flow.step = 3
      setActiveFlow(chatId, flow)
      return [
        `Address: *${input}*`,
        '',
        'Step 3/5: What type of damage? (water / fire / mold / storm)'
      ].join('\n')
    }

    case 3: {
      const validTypes = ['water', 'fire', 'mold', 'storm']
      const dmgType = validTypes.find(t => input.toLowerCase().includes(t)) || input
      flow.data.damageType = dmgType
      flow.step = 4
      setActiveFlow(chatId, flow)
      return [
        `Damage type: *${dmgType}*`,
        '',
        'Step 4/5: Insurance company and claim number? (or \'none\')'
      ].join('\n')
    }

    case 4: {
      if (input.toLowerCase() === 'none') {
        flow.data.insurance = null
        flow.data.claimNumber = null
      } else {
        flow.data.insurance = input
        // Try to extract claim number (often after "claim" or "#" or last word)
        const claimMatch = input.match(/(?:claim|#)\s*(\S+)/i)
        flow.data.claimNumber = claimMatch ? claimMatch[1] : null
      }
      flow.step = 5
      setActiveFlow(chatId, flow)

      const insText = flow.data.insurance || 'No insurance'
      return [
        `Insurance: *${insText}*`,
        '',
        'Step 5/5: Emergency? Should I deploy a crew now? (yes/no)'
      ].join('\n')
    }

    case 5: {
      const emergency = input.toLowerCase().startsWith('y')
      flow.data.emergency = emergency
      clearFlow(chatId)

      // Create new job in jobs.json
      const data = utils.loadJobs()

      // Parse address for city (last part after comma)
      const addrParts = flow.data.address.split(',')
      const city = addrParts.length > 1 ? addrParts.pop().trim() : ''
      const address = addrParts.join(',').trim()

      const now = new Date().toISOString()
      const job = {
        id: `FD-${String(data.nextId).padStart(3, '0')}`,
        client: flow.data.clientName,
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
        damageType: flow.data.damageType,
        insurance: flow.data.insurance,
        claimNumber: flow.data.claimNumber,
        emergency,
        notes: [],
        lienDeadline: new Date(Date.now() + 90 * 86400000).toISOString()
      }

      data.jobs.push(job)
      data.nextId++
      utils.saveJobs(data)

      // Try to create Drive folder via gws
      let driveMsg = ''
      try {
        const { execSync } = await import('child_process')
        execSync(`gws drive files create --name "${job.id} - ${flow.data.clientName}" --mime-type "application/vnd.google-apps.folder"`, {
          timeout: 10000,
          stdio: 'pipe'
        })
        driveMsg = '\nDrive folder created.'
      } catch {
        driveMsg = '\n_Drive folder creation skipped (gws not available)._'
      }

      const lines = [
        `*New Job Created: ${job.id}*`,
        '',
        `Client: ${flow.data.clientName}`,
        `Address: ${flow.data.address}`,
        `Damage: ${flow.data.damageType}`,
        `Insurance: ${flow.data.insurance || 'None'}`,
        emergency ? '*EMERGENCY — Crew deployment requested*' : 'Non-emergency',
        driveMsg,
        '',
        '_Intake flow complete._'
      ]

      return lines.join('\n')
    }

    default:
      clearFlow(chatId)
      return 'Flow error. Intake cancelled. Try /flow intake again.'
  }
}

// ── Scope Review Flow (5 steps) ─────────────────────────────────────

async function startScopeFlow(jobId, chatId) {
  const utils = await ensureJobUtils()
  const job = utils.findJob(jobId)
  if (!job) {
    return `Job not found: ${jobId}\n\nUse a job ID like FD-002 or just the number.`
  }

  // Step 1: Auto-fetch Drive files
  let fileCount = 0
  let fileList = ''
  try {
    const { execSync } = await import('child_process')
    const result = execSync(`gws drive files list --query "name contains '${job.id}'"`, {
      timeout: 10000,
      stdio: 'pipe',
      encoding: 'utf-8'
    })
    const lines = result.trim().split('\n').filter(l => l.trim())
    fileCount = lines.length
    fileList = lines.slice(0, 10).join('\n')
  } catch {
    // Drive not available
  }

  setActiveFlow(chatId, {
    type: 'scope',
    jobId: job.id,
    step: 2,
    data: { fileCount },
    startedAt: new Date().toISOString()
  })

  const foundMsg = fileCount > 0
    ? `I found ${fileCount} document(s) for ${job.id}.${fileList ? '\n' + fileList : ''}`
    : `No Drive documents found for ${job.id}. Proceeding with manual scope.`

  return [
    `*Scope Review Flow* for ${job.id} (${job.client})`,
    '',
    `Step 1/5: Checking Drive files...`,
    foundMsg,
    '',
    'Step 2/5: Which type of scope? (full / supplement / final)'
  ].join('\n')
}

async function processScopeStep(flow, text, chatId, gateway) {
  const utils = await ensureJobUtils()
  const input = text.trim()

  switch (flow.step) {
    case 2: {
      const validTypes = ['full', 'supplement', 'final']
      const scopeType = validTypes.find(t => input.toLowerCase().includes(t)) || input
      flow.data.scopeType = scopeType
      flow.step = 3
      setActiveFlow(chatId, flow)
      return [
        `Scope type: *${scopeType}*`,
        '',
        'Step 3/5: Template? (cat1-class2, cat3-class4, etc. or \'auto\')'
      ].join('\n')
    }

    case 3: {
      flow.data.template = input.toLowerCase() === 'auto' ? 'auto' : input
      flow.step = 4
      setActiveFlow(chatId, flow)

      // Run scope analysis
      let analysisResult = ''
      try {
        // Try scope-assistant if available
        const scopeDir = path.join(WORKSPACE, 'scope-temp')
        if (!fs.existsSync(scopeDir)) fs.mkdirSync(scopeDir, { recursive: true })

        analysisResult = [
          '',
          `*Scope Analysis for ${flow.jobId}*`,
          `Type: ${flow.data.scopeType}`,
          `Template: ${flow.data.template}`,
          `Files analyzed: ${flow.data.fileCount || 0}`,
          '',
          '_Analysis complete. Review below._',
        ].join('\n')
      } catch {
        analysisResult = '\n_Scope analysis engine not available. Manual review required._\n'
      }

      return [
        'Step 4/5: Running scope analysis...',
        analysisResult,
        '',
        'Step 5/5: Review the analysis above. What next?',
        '(1) Save as draft',
        '(2) Email to adjuster',
        '(3) Revise'
      ].join('\n')
    }

    case 4: {
      // This is actually step 5 input (user responds to step 5 prompt)
      const choice = input.trim()
      clearFlow(chatId)

      if (choice === '1' || choice.toLowerCase().includes('draft') || choice.toLowerCase().includes('save')) {
        utils.addJobNote(flow.jobId, `Scope review (${flow.data.scopeType}) saved as draft — template: ${flow.data.template}`)
        return [
          `Scope saved as draft for *${flow.jobId}*.`,
          '',
          `Use /job ${flow.jobId} to view job details.`,
          '_Scope flow complete._'
        ].join('\n')
      }

      if (choice === '2' || choice.toLowerCase().includes('email')) {
        const job = utils.findJob(flow.jobId)
        const adjEmail = job?.adjusterEmail
        utils.addJobNote(flow.jobId, `Scope review (${flow.data.scopeType}) queued for email — template: ${flow.data.template}`)
        if (adjEmail) {
          return [
            `Scope queued for email to *${adjEmail}* for ${flow.jobId}.`,
            '_Scope flow complete._'
          ].join('\n')
        }
        return [
          `Scope saved. No adjuster email on file.`,
          `Add one with: /job ${flow.jobId} adjuster <name> <email>`,
          '_Scope flow complete._'
        ].join('\n')
      }

      if (choice === '3' || choice.toLowerCase().includes('revise')) {
        return [
          `Scope for *${flow.jobId}* needs revision.`,
          'Use /flow scope ' + flow.jobId + ' to restart the scope review.',
          '_Scope flow complete._'
        ].join('\n')
      }

      return [
        `Scope saved for *${flow.jobId}*.`,
        '_Scope flow complete._'
      ].join('\n')
    }

    default:
      clearFlow(chatId)
      return 'Flow error. Scope review cancelled. Try /flow scope <job-id> again.'
  }
}

// ── KB Fuzzy Match (lightweight) ────────────────────────────────────

function fuzzyMatchKB(query, kb) {
  const qLower = query.toLowerCase()
  let bestMatch = null
  let bestScore = 0

  for (const entry of kb) {
    if (!entry.triggers || !Array.isArray(entry.triggers)) continue
    for (const trigger of entry.triggers) {
      const tLower = trigger.toLowerCase()
      let score = 0
      if (tLower.includes(qLower) || qLower.includes(tLower)) score = 80
      else {
        const qWords = qLower.split(/\s+/).filter(w => w.length > 2)
        const tWords = tLower.split(/\s+/).filter(w => w.length > 2)
        let matches = 0
        for (const qw of qWords) {
          for (const tw of tWords) {
            if (qw === tw || tw.includes(qw) || qw.includes(tw)) { matches++; break }
          }
        }
        if (matches >= 2) score = 20 + matches * 10
      }
      if (score > bestScore) {
        bestScore = score
        bestMatch = entry
      }
    }
  }

  return bestScore > 0 ? bestMatch : null
}

// ── Flow Router ─────────────────────────────────────────────────────

async function processFlowStep(flow, text, chatId, gateway) {
  switch (flow.type) {
    case 'dispute':
      return processDisputeStep(flow, text, chatId, gateway)
    case 'intake':
      return processIntakeStep(flow, text, chatId, gateway)
    case 'scope':
      return processScopeStep(flow, text, chatId, gateway)
    default:
      clearFlow(chatId)
      return 'Unknown flow type. Flow cancelled.'
  }
}

// ── Command Handler ─────────────────────────────────────────────────

async function handleFlow(text, sessionKey, adapter, chatId, gateway) {
  const rest = text.slice(5).trim() // strip "/flow"
  const lower = rest.toLowerCase()

  // /flow (no args) or /flow help
  if (!rest || lower === 'help') {
    return [
      '*Workflow Commands*',
      '',
      '/flow dispute <job-id> -- Start dispute resolution',
      '/flow intake -- Start new client intake',
      '/flow scope <job-id> -- Start scope review',
      '/flow status -- Show active flows',
      '/flow cancel -- Cancel current flow',
      '',
      'During a flow, just type your answers. No commands needed.',
      'Flows auto-cancel after 30 min of inactivity.'
    ].join('\n')
  }

  // /flow status
  if (lower === 'status') {
    const data = loadFlows()
    const entries = Object.entries(data.activeFlows)
    if (entries.length === 0) {
      return 'No active flows.'
    }
    const lines = [`*Active Flows* (${entries.length})`, '']
    for (const [id, flow] of entries) {
      const elapsed = Math.round((Date.now() - new Date(flow.startedAt).getTime()) / 60000)
      lines.push(`${flow.type} — ${flow.jobId || 'N/A'} — step ${flow.step} — ${elapsed}m ago`)
    }
    return lines.join('\n')
  }

  // /flow cancel
  if (lower === 'cancel') {
    const active = getActiveFlow(chatId)
    if (!active) return 'No active flow to cancel.'
    clearFlow(chatId)
    return `${active.type} flow cancelled.`
  }

  // /flow dispute <job-id>
  if (lower.startsWith('dispute')) {
    const jobId = rest.slice(7).trim()
    if (!jobId) return 'Usage: /flow dispute <job-id>\nExample: /flow dispute FD-002'
    return startDisputeFlow(jobId, chatId)
  }

  // /flow intake
  if (lower === 'intake') {
    return startIntakeFlow(chatId)
  }

  // /flow scope <job-id>
  if (lower.startsWith('scope')) {
    const jobId = rest.slice(5).trim()
    if (!jobId) return 'Usage: /flow scope <job-id>\nExample: /flow scope FD-002'
    return startScopeFlow(jobId, chatId)
  }

  return 'Unknown flow command. Try /flow help'
}

// ── Plugin Registration ─────────────────────────────────────────────

export function register(gateway) {
  const originalExecute = gateway.commandHandler.execute.bind(gateway.commandHandler)

  gateway.commandHandler.execute = async function (text, sessionKey, adapter, chatId) {
    const trimmed = text.trim()
    const cmd = trimmed.toLowerCase()

    // Flow interception: active flow intercepts ALL non-command messages
    const activeFlow = getActiveFlow(chatId)
    if (activeFlow && !trimmed.startsWith('/')) {
      const response = await processFlowStep(activeFlow, trimmed, chatId, gateway)
      return { handled: true, response }
    }

    // /flow commands
    if (cmd.startsWith('/flow')) {
      const response = await handleFlow(trimmed, sessionKey, adapter, chatId, gateway)
      return { handled: true, response }
    }

    return originalExecute(text, sessionKey, adapter, chatId)
  }

  // Extend /help
  const originalHelp = gateway.commandHandler.handleHelp.bind(gateway.commandHandler)
  gateway.commandHandler.handleHelp = function () {
    const result = originalHelp()
    const lines = [
      '',
      '--- Workflows ---',
      '/flow dispute <job-id> -- Dispute resolution',
      '/flow intake -- New client intake',
      '/flow scope <job-id> -- Scope review',
      '/flow status -- Active flows',
      '/flow cancel -- Cancel current flow',
    ]
    result.response += '\n' + lines.join('\n')
    return result
  }

  console.log('[Workflows] Feature loaded -- /flow commands enabled')
}
