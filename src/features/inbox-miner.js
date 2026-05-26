import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import {
  loadJobs,
  saveJobs,
  findJobByName,
  addJobNote,
  formatDate,
  formatMoneyDollars
} from '../utils/job-data.js'

/**
 * Inbox Miner Feature
 * Scans work email for project-related messages, matches to jobs,
 * extracts adjuster info, addresses, insurance mentions
 *
 * Commands:
 *   /mine inbox           - Full scan of work email
 *   /mine status          - Show mining progress/results
 *   /mine search <name>   - Search emails for a specific client
 *   /mine apply           - Apply mined data to all matched jobs
 *   /mine apply FD-005    - Apply mined data to one job
 *
 * Storage: workspace/inbox-mining-state.json
 */

import config from '../config.js'

const GWS_WORK = config.paths.gwsWorkScript
const WORKSPACE = config.paths.workspace
const STATE_FILE = path.join(WORKSPACE, 'inbox-mining-state.json')

// ── Shell Helper ────────────────────────────────────────────────────

function run(cmd, timeoutMs = 20000) {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: timeoutMs }).trim()
  } catch {
    return null
  }
}

// ── State Persistence ───────────────────────────────────────────────

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
    }
  } catch {}
  return {
    lastFullScan: null,
    emailsScanned: 0,
    matchedToJobs: 0,
    dataExtracted: {},
    unmatchedEmails: []
  }
}

function saveState(state) {
  const dir = path.dirname(STATE_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

// ── Email Fetching ──────────────────────────────────────────────────

/**
 * Search work Gmail and return parsed message list
 */
function searchEmails(query, maxResults = 50) {
  const raw = run(`${GWS_WORK} gmail users messages list --params '{"userId":"me","q":"${query}","maxResults":${maxResults}}'`)
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw)
    return parsed.messages || parsed || []
  } catch {
    return []
  }
}

/**
 * Get message details (headers + snippet)
 */
function getMessageDetail(msgId) {
  const raw = run(`${GWS_WORK} gmail users messages get --id "${msgId}" --format metadata --metadataHeaders "From,Subject,Date"`)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw)
    const headers = parsed.payload?.headers || []
    const from = headers.find(h => h.name === 'From')?.value || ''
    const subject = headers.find(h => h.name === 'Subject')?.value || ''
    const date = headers.find(h => h.name === 'Date')?.value || ''
    const snippet = parsed.snippet || ''

    // Count attachments from parts
    let attachmentCount = 0
    const parts = parsed.payload?.parts || []
    for (const part of parts) {
      if (part.filename && part.filename.length > 0) {
        attachmentCount++
      }
    }

    return {
      id: msgId,
      from: from.replace(/<[^>]+>/, '').trim(),
      fromRaw: from,
      subject: subject.substring(0, 200),
      date,
      snippet: snippet.substring(0, 500),
      attachmentCount
    }
  } catch {
    return null
  }
}

// ── Data Extraction ─────────────────────────────────────────────────

// Street address pattern: number + street name + optional type
const ADDRESS_PATTERN = /\b(\d{1,5}\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Ln|Lane|Ct|Court|Rd|Road|Way|Pl|Place|Cir|Circle|Ter|Terrace|Pike|Hwy|Highway)\.?(?:\s*,?\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)?(?:\s*,?\s*(?:VA|Virginia|MD|Maryland|DC))?(?:\s+\d{5})?)\b/i

// Insurance company names
const INSURANCE_PATTERNS = [
  'State Farm', 'Allstate', 'USAA', 'GEICO', 'Nationwide',
  'Farmers', 'Liberty Mutual', 'Progressive', 'Travelers',
  'Erie Insurance', 'Amica', 'Chubb', 'Hartford', 'Safeco',
  'American Family', 'Auto-Owners', 'Donegal', 'Hanover',
  'Cincinnati Insurance', 'Aetna', 'MetLife'
]

/**
 * Try to extract adjuster name from text near "adjuster" keyword
 */
function extractAdjuster(text) {
  if (!text) return null
  // Look for patterns like "adjuster John Smith", "adjuster: John Smith", "adjuster is John Smith"
  const patterns = [
    /adjuster[:\s]+(?:is\s+)?([A-Z][a-z]+\s+[A-Z][a-z]+)/i,
    /(?:your|the|our)\s+adjuster\s+(?:is\s+)?([A-Z][a-z]+\s+[A-Z][a-z]+)/i,
    /([A-Z][a-z]+\s+[A-Z][a-z]+)\s+(?:is|as)\s+(?:the\s+)?adjuster/i,
  ]

  for (const p of patterns) {
    const m = text.match(p)
    if (m) return m[1].trim()
  }
  return null
}

/**
 * Extract street address from text
 */
function extractAddress(text) {
  if (!text) return null
  const m = text.match(ADDRESS_PATTERN)
  return m ? m[1].trim() : null
}

/**
 * Find insurance company mentions
 */
function extractInsurance(text) {
  if (!text) return null
  const lower = text.toLowerCase()
  for (const name of INSURANCE_PATTERNS) {
    if (lower.includes(name.toLowerCase())) return name
  }
  return null
}

// ── Job Matching ────────────────────────────────────────────────────

/**
 * Try to match an email to a job by scanning subject + snippet for client names
 */
function matchEmailToJobs(email, jobs) {
  const searchText = `${email.subject} ${email.snippet}`.toLowerCase()
  const matches = []

  for (const job of jobs) {
    const client = (job.client || '').toLowerCase()
    if (!client || client.length < 3) continue

    // Try full name match first
    if (searchText.includes(client)) {
      matches.push(job)
      continue
    }

    // Try last name match (if name has 2+ parts and last name >= 4 chars)
    const parts = client.split(/\s+/)
    if (parts.length >= 2) {
      const lastName = parts[parts.length - 1]
      if (lastName.length >= 4 && searchText.includes(lastName)) {
        matches.push(job)
      }
    }
  }

  return matches
}

// ── Command: /mine inbox ────────────────────────────────────────────

async function handleMineInbox() {
  const state = loadState()
  const jobsData = loadJobs()
  const jobs = jobsData.jobs

  if (jobs.length === 0) {
    return 'No jobs in jobs.json to match against. Add jobs first with /job new.'
  }

  const lines = ['Scanning work email inbox...', '']

  // Search queries targeting team and project-related emails
  const queries = [
    'from:steve OR from:shyon',
    'subject:scope OR subject:estimate OR subject:adjuster',
    'subject:invoice OR subject:payment OR subject:claim',
    'subject:restoration OR subject:flood OR subject:water damage'
  ]

  const allMessageIds = new Set()
  const allMessages = []

  for (const query of queries) {
    const messages = searchEmails(query, 50)
    for (const msg of messages) {
      if (msg.id && !allMessageIds.has(msg.id)) {
        allMessageIds.add(msg.id)
        allMessages.push(msg)
      }
    }
  }

  if (allMessages.length === 0) {
    return 'No emails found matching search criteria. Check that gws-work.sh is authenticated.'
  }

  lines.push(`Found ${allMessages.length} emails to scan...`)

  let scanned = 0
  let matched = 0
  const dataExtracted = {}
  const unmatchedEmails = []

  for (const msg of allMessages) {
    const detail = getMessageDetail(msg.id)
    if (!detail) continue
    scanned++

    const fullText = `${detail.subject} ${detail.snippet}`
    const jobMatches = matchEmailToJobs(detail, jobs)

    if (jobMatches.length > 0) {
      matched++
      for (const job of jobMatches) {
        if (!dataExtracted[job.id]) {
          dataExtracted[job.id] = {
            foundAdjuster: null,
            foundAddress: null,
            foundInsurance: null,
            emailIds: [],
            attachmentCount: 0
          }
        }

        const entry = dataExtracted[job.id]
        entry.emailIds.push(detail.id)
        entry.attachmentCount += detail.attachmentCount

        // Extract data if not already found
        if (!entry.foundAdjuster) {
          entry.foundAdjuster = extractAdjuster(fullText)
        }
        if (!entry.foundAddress) {
          entry.foundAddress = extractAddress(fullText)
        }
        if (!entry.foundInsurance) {
          entry.foundInsurance = extractInsurance(fullText)
        }
      }
    } else {
      unmatchedEmails.push({
        subject: detail.subject,
        from: detail.from,
        date: detail.date
      })
    }
  }

  // Save state
  state.lastFullScan = new Date().toISOString()
  state.emailsScanned = scanned
  state.matchedToJobs = matched
  state.dataExtracted = dataExtracted
  state.unmatchedEmails = unmatchedEmails.slice(0, 50) // keep last 50
  saveState(state)

  // Build results
  const jobIds = Object.keys(dataExtracted)
  lines.push(`Scanned: ${scanned} emails`)
  lines.push(`Matched to jobs: ${matched}`)
  lines.push(`Jobs with data: ${jobIds.length}`)
  lines.push(`Unmatched: ${unmatchedEmails.length}`)
  lines.push('')

  // Show what was found
  if (jobIds.length > 0) {
    lines.push('*Data found:*')
    for (const jobId of jobIds.slice(0, 15)) {
      const d = dataExtracted[jobId]
      const job = jobs.find(j => j.id === jobId)
      const client = job ? job.client : jobId
      const parts = []
      if (d.foundAdjuster) parts.push(`adj: ${d.foundAdjuster}`)
      if (d.foundAddress) parts.push(`addr: ${d.foundAddress}`)
      if (d.foundInsurance) parts.push(`ins: ${d.foundInsurance}`)
      if (d.attachmentCount > 0) parts.push(`${d.attachmentCount} attachments`)
      parts.push(`${d.emailIds.length} emails`)

      lines.push(`  ${jobId} ${client} | ${parts.join(', ')}`)
    }
    if (jobIds.length > 15) {
      lines.push(`  ... +${jobIds.length - 15} more`)
    }
    lines.push('')
    lines.push('Run `/mine apply` to update jobs.json with found data')
    lines.push('Run `/mine apply FD-005` to update just one job')
  }

  return lines.join('\n')
}

// ── Command: /mine status ───────────────────────────────────────────

function handleMineStatus() {
  const state = loadState()

  if (!state.lastFullScan) {
    return 'No mining has been done yet. Run `/mine inbox` to start.'
  }

  const lines = [
    '*Inbox Mining Status*',
    '',
    `Last scan: ${formatDate(state.lastFullScan)}`,
    `Emails scanned: ${state.emailsScanned}`,
    `Matched to jobs: ${state.matchedToJobs}`,
    `Jobs with data: ${Object.keys(state.dataExtracted).length}`,
    `Unmatched emails: ${state.unmatchedEmails.length}`,
  ]

  const extracted = state.dataExtracted
  const jobIds = Object.keys(extracted)

  if (jobIds.length > 0) {
    let withAdjuster = 0
    let withAddress = 0
    let withInsurance = 0
    let totalAttachments = 0

    for (const id of jobIds) {
      const d = extracted[id]
      if (d.foundAdjuster) withAdjuster++
      if (d.foundAddress) withAddress++
      if (d.foundInsurance) withInsurance++
      totalAttachments += d.attachmentCount || 0
    }

    lines.push('')
    lines.push('*Extracted data summary:*')
    if (withAdjuster > 0) lines.push(`  Adjusters found: ${withAdjuster}`)
    if (withAddress > 0) lines.push(`  Addresses found: ${withAddress}`)
    if (withInsurance > 0) lines.push(`  Insurance co. found: ${withInsurance}`)
    if (totalAttachments > 0) lines.push(`  Attachments noted: ${totalAttachments}`)
  }

  // Show what can be applied
  const jobsData = loadJobs()
  let applyable = 0

  for (const jobId of jobIds) {
    const d = extracted[jobId]
    const job = jobsData.jobs.find(j => j.id === jobId)
    if (!job) continue

    if ((d.foundAdjuster && !job.adjuster) ||
        (d.foundAddress && !job.address) ||
        (d.foundInsurance && !job.insuranceCompany)) {
      applyable++
    }
  }

  if (applyable > 0) {
    lines.push('')
    lines.push(`${applyable} jobs have empty fields that can be filled.`)
    lines.push('Run `/mine apply` to update them.')
  }

  return lines.join('\n')
}

// ── Command: /mine search <name> ────────────────────────────────────

function handleMineSearch(name) {
  if (!name) {
    return 'Usage: /mine search <client name>'
  }

  const messages = searchEmails(`"${name}"`, 20)

  if (messages.length === 0) {
    return `No emails found mentioning "${name}".`
  }

  const lines = [`*Email search: "${name}"*`, '']
  let count = 0

  for (const msg of messages.slice(0, 10)) {
    const detail = getMessageDetail(msg.id)
    if (!detail) continue
    count++

    lines.push(`From: ${detail.from}`)
    lines.push(`Subject: ${detail.subject}`)
    lines.push(`Date: ${detail.date}`)
    if (detail.attachmentCount > 0) {
      lines.push(`Attachments: ${detail.attachmentCount}`)
    }
    lines.push(`Snippet: ${detail.snippet.substring(0, 150)}...`)
    lines.push('')
  }

  if (count === 0) {
    return `Found ${messages.length} message IDs but could not read details.`
  }

  // Check if name matches any jobs
  const jobMatches = findJobByName(name)
  if (jobMatches.length > 0) {
    lines.push(`Matching jobs: ${jobMatches.map(j => `${j.id} (${j.client})`).join(', ')}`)
  }

  return lines.join('\n')
}

// ── Command: /mine apply [id] ───────────────────────────────────────

function handleMineApply(targetId) {
  const state = loadState()

  if (!state.lastFullScan || Object.keys(state.dataExtracted).length === 0) {
    return 'No mining data to apply. Run `/mine inbox` first.'
  }

  const jobsData = loadJobs()
  const extracted = state.dataExtracted
  let updated = 0
  const updates = []

  const jobIds = targetId ? [targetId.toUpperCase()] : Object.keys(extracted)

  for (const jobId of jobIds) {
    const d = extracted[jobId]
    if (!d) {
      if (targetId) return `No mined data for ${jobId}. Run /mine inbox first.`
      continue
    }

    const job = jobsData.jobs.find(j => j.id === jobId)
    if (!job) continue

    const changes = []

    // Only fill empty fields — never overwrite existing data
    if (d.foundAdjuster && !job.adjuster) {
      job.adjuster = d.foundAdjuster
      changes.push(`adjuster: ${d.foundAdjuster}`)
    }

    if (d.foundAddress && !job.address) {
      job.address = d.foundAddress
      changes.push(`address: ${d.foundAddress}`)
    }

    if (d.foundInsurance && !job.insuranceCompany) {
      job.insuranceCompany = d.foundInsurance
      changes.push(`insurance: ${d.foundInsurance}`)
    }

    if (changes.length > 0) {
      // Add a note about the auto-populated data
      if (!Array.isArray(job.notes)) job.notes = []
      job.notes.push({
        text: `[InboxMiner] Auto-populated: ${changes.join(', ')}`,
        date: new Date().toISOString()
      })

      updated++
      updates.push(`${jobId} (${job.client}): ${changes.join(', ')}`)
    }
  }

  if (updated === 0) {
    if (targetId) {
      return `${targetId}: No empty fields to fill, or no new data found.`
    }
    return 'No updates to apply. All matching fields already populated.'
  }

  saveJobs(jobsData)

  const lines = [
    `*Updated ${updated} job${updated > 1 ? 's' : ''}:*`,
    '',
    ...updates.map(u => `  ${u}`),
    '',
    'Data sourced from email mining. Verify for accuracy.'
  ]

  return lines.join('\n')
}

// ── Command Router ──────────────────────────────────────────────────

async function handleMine(text, gateway) {
  // Strip "/mine" prefix
  const rest = text.slice(5).trim().toLowerCase()
  const restOriginal = text.slice(5).trim()

  if (!rest || rest === 'help') {
    return [
      '*Inbox Miner Commands*',
      '',
      '/mine inbox — scan work email, match to jobs',
      '/mine status — show mining results',
      '/mine search <name> — search emails for client',
      '/mine apply — update jobs with mined data',
      '/mine apply <id> — update one job',
    ].join('\n')
  }

  if (rest === 'inbox') {
    return await handleMineInbox()
  }

  if (rest === 'status') {
    return handleMineStatus()
  }

  if (rest.startsWith('search ')) {
    const name = restOriginal.slice(7).trim()
    return handleMineSearch(name)
  }

  if (rest === 'apply') {
    return handleMineApply()
  }

  if (rest.startsWith('apply ')) {
    const id = restOriginal.slice(6).trim()
    return handleMineApply(id)
  }

  return 'Unknown mine command. Try `/mine help`.'
}

// ── Plugin Registration ─────────────────────────────────────────────

export function register(gateway) {
  const originalExecute = gateway.commandHandler.execute.bind(gateway.commandHandler)

  gateway.commandHandler.execute = async function (text, sessionKey, adapter, chatId) {
    if (text.trim().toLowerCase().startsWith('/mine')) {
      const response = await handleMine(text.trim(), gateway)
      return { handled: true, response }
    }

    return originalExecute(text, sessionKey, adapter, chatId)
  }

  // Extend /help
  const originalHelp = gateway.commandHandler.handleHelp.bind(gateway.commandHandler)
  gateway.commandHandler.handleHelp = function () {
    const result = originalHelp()
    const mineLines = [
      '',
      '--- Inbox Miner ---',
      '/mine inbox \u2014 scan work email, match to jobs',
      '/mine status \u2014 mining results',
      '/mine search <name> \u2014 search emails for client',
      '/mine apply [id] \u2014 update jobs with mined data'
    ]
    result.response += '\n' + mineLines.join('\n')
    return result
  }

  console.log('[InboxMiner] Feature loaded \u2014 /mine commands enabled')
}
