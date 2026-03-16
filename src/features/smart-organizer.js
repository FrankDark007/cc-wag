import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import {
  loadJobs,
  findJob,
  updateJob,
  addJobNote
} from '../utils/job-data.js'
import config from '../config.js'

/**
 * Smart Organizer Feature
 * Gmail filter automation + Drive folder auto-creation for jobs.
 *
 * Commands:
 *   /filter create FD-005         - Create Gmail label + filter for a job
 *   /filter create adjuster <email> - Create filter for adjuster emails
 *   /filter create insurance <name> - Create filter for insurance company
 *   /filter list                  - Show all Atlas-created filters
 *   /filter auto                  - Auto-create filters for all active jobs
 *   /filter help                  - Show filter commands
 *
 *   /folders create FD-005        - Create Drive folder structure for a job
 *   /folders auto                 - Auto-create folders for all jobs missing one
 *   /folders list FD-005          - Show folder structure for a job
 *   /folders help                 - Show folder commands
 *
 *   /organize FD-005              - Create both folders + filter for a job
 *   /organize auto                - Do both for all jobs missing folders or filters
 *
 * Storage: workspace/gmail-filters-state.json
 */

const GWS = config.paths.gwsBin
const GWS_WORK = config.paths.gwsWorkScript
const WORKSPACE = config.paths.workspace
const DRIVE_PARENT = '1QYQysnw8kYfwY14fgPgfAx5nlqlmfSxW'
const STATE_FILE = path.join(WORKSPACE, 'gmail-filters-state.json')

const SUBFOLDER_NAMES = [
  '01 - Scope & Estimates',
  '02 - Photos & Video',
  '03 - Labor & Time Logs',
  '04 - Insurance Correspondence',
  '05 - Invoices & Payments',
  '06 - Equipment & Moisture Logs'
]

// ── Shell Helper ────────────────────────────────────────────────────

function run(cmd, timeoutMs = 15000) {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: timeoutMs }).trim()
  } catch (err) {
    console.error('[SmartOrganizer] Command failed:', err.message)
    return null
  }
}

function parseJSON(raw) {
  if (!raw) return null
  try {
    const jsonStart = raw.indexOf('{')
    const jsonArrayStart = raw.indexOf('[')
    const start = jsonStart === -1 ? jsonArrayStart
      : jsonArrayStart === -1 ? jsonStart
      : Math.min(jsonStart, jsonArrayStart)
    if (start === -1) return null
    return JSON.parse(raw.slice(start))
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
  } catch (err) {
    console.error('[SmartOrganizer] Failed to load state:', err.message)
  }
  return { labels: {}, adjusterFilters: {}, insuranceFilters: {} }
}

function saveState(state) {
  const dir = path.dirname(STATE_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

// ── Gmail Helpers ───────────────────────────────────────────────────

function getClientLastName(client) {
  if (!client) return ''
  const parts = client.trim().split(/\s+/)
  return parts[parts.length - 1]
}

function createGmailLabel(labelName) {
  const json = JSON.stringify({
    name: labelName,
    labelListVisibility: 'labelShow',
    messageListVisibility: 'show'
  })
  const raw = run(`${GWS_WORK} gmail users labels create --params '{"userId":"me"}' --json '${json}'`)
  const parsed = parseJSON(raw)
  if (parsed && parsed.id) return parsed
  // Label may already exist — try to find it
  return findLabelByName(labelName)
}

function findLabelByName(name) {
  const raw = run(`${GWS_WORK} gmail users labels list --params '{"userId":"me"}'`, 20000)
  const parsed = parseJSON(raw)
  if (!parsed) return null
  const labels = parsed.labels || []
  return labels.find(l => l.name === name) || null
}

function createGmailFilter(criteria, labelId, starIt = false) {
  const action = {
    addLabelIds: [labelId],
    removeLabelIds: []
  }
  if (starIt) {
    action.addLabelIds.push('STARRED')
  }
  const filterJson = JSON.stringify({ criteria, action })
  // Escape single quotes in JSON for shell
  const escaped = filterJson.replace(/'/g, "'\\''")
  const raw = run(`${GWS_WORK} gmail users settings filters create --params '{"userId":"me"}' --json '${escaped}'`)
  return parseJSON(raw)
}

// ── Drive Helpers ───────────────────────────────────────────────────

function createDriveFolder(name, parentId) {
  const json = JSON.stringify({
    name,
    mimeType: 'application/vnd.google-apps.folder',
    parents: [parentId]
  })
  const raw = run(`${GWS} drive files create --json '${json}'`, 20000)
  return parseJSON(raw)
}

function listDriveFolderContents(folderId) {
  const params = JSON.stringify({
    q: `"${folderId}" in parents`,
    fields: 'files(id,name,mimeType)'
  })
  const raw = run(`${GWS} drive files list --params '${params}'`, 20000)
  return parseJSON(raw)
}

// ── Filter Commands ─────────────────────────────────────────────────

function handleFilterCreate(args) {
  const parts = args.trim().split(/\s+/)
  if (parts.length === 0 || !parts[0]) {
    return 'Usage: `/filter create FD-005` or `/filter create adjuster <email>` or `/filter create insurance <name>`'
  }

  // Adjuster filter
  if (parts[0].toLowerCase() === 'adjuster') {
    return handleAdjusterFilter(parts.slice(1).join(' '))
  }

  // Insurance filter
  if (parts[0].toLowerCase() === 'insurance') {
    return handleInsuranceFilter(parts.slice(1).join(' '))
  }

  // Job filter
  return handleJobFilter(parts[0])
}

function handleJobFilter(jobId) {
  const job = findJob(jobId)
  if (!job) return `Job *${jobId}* not found.`

  const state = loadState()
  if (state.labels[job.id]) {
    return `Filter already exists for *${job.id}*.\nLabel ID: \`${state.labels[job.id].labelId}\``
  }

  const lastName = getClientLastName(job.client)
  const labelName = `Jobs/${job.id} - ${lastName}`

  // Create label
  const label = createGmailLabel(labelName)
  if (!label || !label.id) {
    return `Failed to create Gmail label "${labelName}". Check gws auth.`
  }

  // Build filter criteria: match job ID or client last name
  const queryParts = [job.id]
  if (lastName) queryParts.push(`"${lastName}"`)
  const query = queryParts.join(' OR ')

  const filter = createGmailFilter({ query }, label.id)
  const filterId = filter ? (filter.id || null) : null

  // Save state
  state.labels[job.id] = {
    labelId: label.id,
    filterId,
    labelName,
    query,
    createdAt: new Date().toISOString()
  }
  saveState(state)

  const filterStatus = filterId ? 'filter created' : 'label created (filter may need manual setup)'
  return `*Gmail filter set up for ${job.id}*\n\n` +
    `Label: \`${labelName}\`\n` +
    `Query: \`${query}\`\n` +
    `Status: ${filterStatus}`
}

function handleAdjusterFilter(input) {
  if (!input) return 'Usage: `/filter create adjuster mike@statefarm.com`'

  const email = input.trim().toLowerCase()
  if (!email.includes('@')) return `"${input}" doesn't look like an email address.`

  const state = loadState()
  if (state.adjusterFilters[email]) {
    return `Adjuster filter already exists for *${email}*.\nLabel: \`${state.adjusterFilters[email].labelName}\``
  }

  // Derive a name from the email local part
  const localPart = email.split('@')[0]
  const displayName = localPart
    .replace(/[._-]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
  const labelName = `Adjusters/${displayName}`

  const label = createGmailLabel(labelName)
  if (!label || !label.id) {
    return `Failed to create Gmail label "${labelName}". Check gws auth.`
  }

  // Filter: from this email, star it, never spam
  const filter = createGmailFilter({ from: email }, label.id, true)
  const filterId = filter ? (filter.id || null) : null

  state.adjusterFilters[email] = {
    labelId: label.id,
    filterId,
    labelName,
    name: displayName,
    createdAt: new Date().toISOString()
  }
  saveState(state)

  const filterStatus = filterId ? 'filter + star active' : 'label created (filter may need manual setup)'
  return `*Adjuster filter created*\n\n` +
    `Email: ${email}\n` +
    `Label: \`${labelName}\`\n` +
    `Status: ${filterStatus}`
}

function handleInsuranceFilter(input) {
  if (!input) return 'Usage: `/filter create insurance "State Farm"`'

  const name = input.replace(/^["']|["']$/g, '').trim()
  if (!name) return 'Please provide the insurance company name.'

  const state = loadState()
  if (state.insuranceFilters[name]) {
    return `Insurance filter already exists for *${name}*.\nLabel: \`${state.insuranceFilters[name].labelName}\``
  }

  const labelName = `Insurance/${name}`
  const label = createGmailLabel(labelName)
  if (!label || !label.id) {
    return `Failed to create Gmail label "${labelName}". Check gws auth.`
  }

  const filter = createGmailFilter({ query: `"${name}"` }, label.id)
  const filterId = filter ? (filter.id || null) : null

  state.insuranceFilters[name] = {
    labelId: label.id,
    filterId,
    labelName,
    createdAt: new Date().toISOString()
  }
  saveState(state)

  const filterStatus = filterId ? 'filter active' : 'label created (filter may need manual setup)'
  return `*Insurance filter created*\n\n` +
    `Company: ${name}\n` +
    `Label: \`${labelName}\`\n` +
    `Status: ${filterStatus}`
}

function handleFilterList() {
  const state = loadState()
  const jobCount = Object.keys(state.labels).length
  const adjCount = Object.keys(state.adjusterFilters).length
  const insCount = Object.keys(state.insuranceFilters).length

  if (jobCount + adjCount + insCount === 0) {
    return 'No filters created yet.\n\nUse `/filter create FD-005` to get started.'
  }

  let msg = '*Atlas Gmail Filters*\n\n'

  if (jobCount > 0) {
    msg += `*Job Filters (${jobCount}):*\n`
    for (const [id, info] of Object.entries(state.labels)) {
      msg += `  - ${id}: \`${info.labelName}\` (${info.query})\n`
    }
    msg += '\n'
  }

  if (adjCount > 0) {
    msg += `*Adjuster Filters (${adjCount}):*\n`
    for (const [email, info] of Object.entries(state.adjusterFilters)) {
      msg += `  - ${email}: \`${info.labelName}\`\n`
    }
    msg += '\n'
  }

  if (insCount > 0) {
    msg += `*Insurance Filters (${insCount}):*\n`
    for (const [name, info] of Object.entries(state.insuranceFilters)) {
      msg += `  - ${name}: \`${info.labelName}\`\n`
    }
  }

  return msg.trim()
}

function handleFilterAuto() {
  const data = loadJobs()
  const state = loadState()
  const activeStatuses = ['active', 'completed', 'needs-invoice', 'invoiced', 'payment-pending']
  const eligible = data.jobs.filter(j =>
    activeStatuses.includes((j.status || '').toLowerCase()) &&
    !state.labels[j.id]
  )

  if (eligible.length === 0) {
    return 'All active jobs already have Gmail filters. Nothing to do.'
  }

  const results = []
  let created = 0
  let failed = 0

  for (const job of eligible) {
    const lastName = getClientLastName(job.client)
    const labelName = `Jobs/${job.id} - ${lastName}`
    const label = createGmailLabel(labelName)
    if (!label || !label.id) {
      results.push(`  - ${job.id} (${job.client}): FAILED`)
      failed++
      continue
    }

    const queryParts = [job.id]
    if (lastName) queryParts.push(`"${lastName}"`)
    const query = queryParts.join(' OR ')

    const filter = createGmailFilter({ query }, label.id)
    const filterId = filter ? (filter.id || null) : null

    state.labels[job.id] = {
      labelId: label.id,
      filterId,
      labelName,
      query,
      createdAt: new Date().toISOString()
    }
    results.push(`  - ${job.id} (${job.client}): created`)
    created++
  }

  saveState(state)

  return `*Auto-created Gmail filters*\n\n` +
    `Created: ${created} | Failed: ${failed}\n\n` +
    results.join('\n')
}

function handleFilterHelp() {
  return `*Gmail Filter Commands*\n\n` +
    '`/filter create FD-005` - Create label + filter for a job\n' +
    '`/filter create adjuster mike@sf.com` - Filter for adjuster emails\n' +
    '`/filter create insurance "State Farm"` - Filter for insurance co\n' +
    '`/filter list` - Show all Atlas-created filters\n' +
    '`/filter auto` - Auto-create for all active jobs\n' +
    '`/filter help` - This message'
}

// ── Folder Commands ─────────────────────────────────────────────────

function createJobFolders(jobId) {
  const job = findJob(jobId)
  if (!job) return { success: false, message: `Job *${jobId}* not found.` }

  if (job.driveFolderId) {
    return {
      success: true,
      message: `Job *${job.id}* already has a Drive folder.\nID: \`${job.driveFolderId}\``,
      folderId: job.driveFolderId
    }
  }

  const lastName = getClientLastName(job.client)
  const folderName = `${job.id} - ${lastName}`

  // Create parent folder
  const parent = createDriveFolder(folderName, DRIVE_PARENT)
  if (!parent || !parent.id) {
    return { success: false, message: `Failed to create Drive folder "${folderName}". Check gws auth.` }
  }

  // Create subfolders
  let subCreated = 0
  for (const sub of SUBFOLDER_NAMES) {
    const result = createDriveFolder(sub, parent.id)
    if (result && result.id) subCreated++
  }

  // Update job record
  const driveUrl = `https://drive.google.com/drive/folders/${parent.id}`
  updateJob(job.id, { driveFolderId: parent.id, driveUrl })
  addJobNote(job.id, `Drive folder created with ${subCreated} subfolders`)

  return {
    success: true,
    message: `*Drive folders created for ${job.id}*\n\n` +
      `Folder: ${folderName}\n` +
      `Subfolders: ${subCreated}/${SUBFOLDER_NAMES.length}\n` +
      `Link: ${driveUrl}`,
    folderId: parent.id
  }
}

function handleFoldersCreate(args) {
  const jobId = args.trim()
  if (!jobId) return 'Usage: `/folders create FD-005`'
  const result = createJobFolders(jobId)
  return result.message
}

function handleFoldersAuto() {
  const data = loadJobs()
  const eligible = data.jobs.filter(j => !j.driveFolderId)

  if (eligible.length === 0) {
    return 'All jobs already have Drive folders. Nothing to do.'
  }

  const results = []
  let created = 0
  let failed = 0

  for (const job of eligible) {
    const result = createJobFolders(job.id)
    if (result.success && result.folderId) {
      results.push(`  - ${job.id} (${job.client}): created`)
      created++
    } else {
      results.push(`  - ${job.id} (${job.client}): FAILED`)
      failed++
    }
  }

  return `*Auto-created Drive folders*\n\n` +
    `Created: ${created} | Failed: ${failed}\n\n` +
    results.join('\n')
}

function handleFoldersList(args) {
  const jobId = args.trim()
  if (!jobId) return 'Usage: `/folders list FD-005`'

  const job = findJob(jobId)
  if (!job) return `Job *${jobId}* not found.`
  if (!job.driveFolderId) return `Job *${job.id}* has no Drive folder yet.\nUse \`/folders create ${job.id}\` to create one.`

  const contents = listDriveFolderContents(job.driveFolderId)
  if (!contents || !contents.files) {
    return `Could not list contents for *${job.id}* folder.\nDrive URL: ${job.driveUrl || 'N/A'}`
  }

  const folders = contents.files.filter(f => f.mimeType === 'application/vnd.google-apps.folder')
  const files = contents.files.filter(f => f.mimeType !== 'application/vnd.google-apps.folder')

  let msg = `*Drive folder for ${job.id}*\n\n`
  if (folders.length > 0) {
    for (const f of folders.sort((a, b) => a.name.localeCompare(b.name))) {
      msg += `  - ${f.name}/\n`
    }
  }
  if (files.length > 0) {
    msg += '\nFiles:\n'
    for (const f of files) {
      msg += `  - ${f.name}\n`
    }
  }
  if (folders.length === 0 && files.length === 0) {
    msg += '(empty folder)'
  }
  msg += `\nLink: ${job.driveUrl || `https://drive.google.com/drive/folders/${job.driveFolderId}`}`
  return msg
}

function handleFoldersHelp() {
  return `*Drive Folder Commands*\n\n` +
    '`/folders create FD-005` - Create folder structure for a job\n' +
    '`/folders auto` - Auto-create for all jobs missing folders\n' +
    '`/folders list FD-005` - Show folder contents for a job\n' +
    '`/folders help` - This message'
}

// ── Organize (Combined) ────────────────────────────────────────────

function handleOrganizeJob(jobId) {
  const job = findJob(jobId)
  if (!job) return `Job *${jobId}* not found.`

  const parts = []

  // Folders
  const folderResult = createJobFolders(job.id)
  parts.push(folderResult.message)

  // Filter
  const filterResult = handleJobFilter(job.id)
  parts.push(filterResult)

  return parts.join('\n\n---\n\n')
}

function handleOrganizeAuto() {
  const data = loadJobs()
  const state = loadState()
  const activeStatuses = ['active', 'completed', 'needs-invoice', 'invoiced', 'payment-pending']

  const needsFolders = data.jobs.filter(j => !j.driveFolderId)
  const needsFilters = data.jobs.filter(j =>
    activeStatuses.includes((j.status || '').toLowerCase()) &&
    !state.labels[j.id]
  )

  // Get unique jobs that need either
  const needsWork = new Map()
  for (const j of [...needsFolders, ...needsFilters]) {
    needsWork.set(j.id, j)
  }

  if (needsWork.size === 0) {
    return 'All jobs are fully organized. Nothing to do.'
  }

  const results = []
  let folderCount = 0
  let filterCount = 0

  for (const [id, job] of needsWork) {
    const line = [`*${id}* (${job.client}):`]

    if (!job.driveFolderId) {
      const fr = createJobFolders(id)
      line.push(fr.success ? 'folders created' : 'folders FAILED')
      if (fr.success) folderCount++
    }

    if (!state.labels[id] && activeStatuses.includes((job.status || '').toLowerCase())) {
      // Reload state since createJobFolders may have run
      const freshState = loadState()
      if (!freshState.labels[id]) {
        const lastName = getClientLastName(job.client)
        const labelName = `Jobs/${id} - ${lastName}`
        const label = createGmailLabel(labelName)
        if (label && label.id) {
          const queryParts = [id]
          if (lastName) queryParts.push(`"${lastName}"`)
          const query = queryParts.join(' OR ')
          const filter = createGmailFilter({ query }, label.id)
          freshState.labels[id] = {
            labelId: label.id,
            filterId: filter ? (filter.id || null) : null,
            labelName,
            query,
            createdAt: new Date().toISOString()
          }
          saveState(freshState)
          line.push('filter created')
          filterCount++
        } else {
          line.push('filter FAILED')
        }
      }
    }

    results.push(`  - ${line.join(' | ')}`)
  }

  return `*Auto-organized ${needsWork.size} jobs*\n\n` +
    `Folders created: ${folderCount} | Filters created: ${filterCount}\n\n` +
    results.join('\n')
}

// ── Router ──────────────────────────────────────────────────────────

function createJobFilter(jobId) {
  return handleJobFilter(jobId)
}

function createAdjusterFilter(email, name) {
  // If name provided, we can use it; otherwise derive from email
  return handleAdjusterFilter(email)
}

async function handleOrganize(text, gateway) {
  const trimmed = text.trim()

  // /filter commands
  if (trimmed.toLowerCase().startsWith('/filter')) {
    const rest = trimmed.slice(7).trim()
    const sub = rest.toLowerCase()

    if (sub.startsWith('create')) {
      return handleFilterCreate(rest.slice(6).trim())
    }
    if (sub === 'list') return handleFilterList()
    if (sub === 'auto') return handleFilterAuto()
    if (sub === 'help' || sub === '') return handleFilterHelp()
    return handleFilterHelp()
  }

  // /folders commands
  if (trimmed.toLowerCase().startsWith('/folders')) {
    const rest = trimmed.slice(8).trim()
    const sub = rest.toLowerCase()

    if (sub.startsWith('create')) {
      return handleFoldersCreate(rest.slice(6).trim())
    }
    if (sub.startsWith('list')) return handleFoldersList(rest.slice(4).trim())
    if (sub === 'auto') return handleFoldersAuto()
    if (sub === 'help' || sub === '') return handleFoldersHelp()
    return handleFoldersHelp()
  }

  // /organize commands
  if (trimmed.toLowerCase().startsWith('/organize')) {
    const rest = trimmed.slice(9).trim()
    if (!rest || rest.toLowerCase() === 'help') {
      return `*Organize Commands*\n\n` +
        '`/organize FD-005` - Create Drive folders + Gmail filter for a job\n' +
        '`/organize auto` - Do both for all jobs needing setup\n\n' +
        'Also available: `/filter help` and `/folders help`'
    }
    if (rest.toLowerCase() === 'auto') return handleOrganizeAuto()
    return handleOrganizeJob(rest)
  }

  return 'Unknown command. Try `/filter help`, `/folders help`, or `/organize help`.'
}

// ── Registration ────────────────────────────────────────────────────

export function register(gateway) {
  const originalExecute = gateway.commandHandler.execute.bind(gateway.commandHandler)

  gateway.commandHandler.execute = async function (text, sessionKey, adapter, chatId) {
    const cmd = text.trim().toLowerCase()
    if (cmd.startsWith('/filter') || cmd.startsWith('/folders') || cmd.startsWith('/organize')) {
      const response = await handleOrganize(text.trim(), gateway)
      return { handled: true, response }
    }
    return originalExecute(text, sessionKey, adapter, chatId)
  }

  // Expose API for other features (e.g., job-tracker auto-hook)
  gateway._smartOrganizer = {
    createJobFolders,
    createJobFilter,
    createAdjusterFilter
  }

  console.log('[SmartOrganizer] Feature loaded \u2014 /filter, /folders, /organize commands')
}
