import fs from 'fs'
import { execSync } from 'child_process'

/**
 * Document Package Builder Feature
 * Assembles all supporting docs from a job's Drive folder into a categorized list
 * and can send the package to an adjuster via email.
 *
 * Commands:
 *   /package <job-id>                          — list all files in job's Drive folder, categorized
 *   /package <job-id> send <email>             — send package email with doc links
 *
 * Uses gws CLI for Drive access, gws-work.sh for sending from frank@flood.doctor
 */

import config from '../config.js'

const JOBS_FILE = config.paths.jobsFile
const DISPUTES_FILE = config.paths.disputesFile
const GWS = config.paths.gwsBin
const GWS_WORK = config.paths.gwsWorkScript

// File categorization by name patterns and mime types
const CATEGORIES = [
  {
    name: 'Scope Sheets & Estimates',
    patterns: [/scope/i, /estimate/i, /xactimate/i, /xact/i, /ESX/i],
    mimes: []
  },
  {
    name: 'Moisture Logs & Readings',
    patterns: [/moisture/i, /reading/i, /psychrometric/i, /monitoring/i, /daily.?log/i],
    mimes: []
  },
  {
    name: 'Labor Logs & Timesheets',
    patterns: [/labor/i, /timesheet/i, /time.?log/i, /hours/i, /work.?log/i],
    mimes: []
  },
  {
    name: 'Photos & Images',
    patterns: [/photo/i, /image/i, /pic/i, /IMG_/i, /DSC/i],
    mimes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
  },
  {
    name: 'Invoices & Billing',
    patterns: [/invoice/i, /billing/i, /receipt/i, /payment/i],
    mimes: []
  },
  {
    name: 'Contracts & Authorizations',
    patterns: [/contract/i, /auth/i, /agreement/i, /consent/i, /signed/i, /AOB/i],
    mimes: []
  },
  {
    name: 'Testing Reports',
    patterns: [/test/i, /asbestos/i, /mold/i, /lead/i, /lab/i, /report/i],
    mimes: []
  },
  {
    name: 'Equipment Records',
    patterns: [/equipment/i, /dehu/i, /air.?mover/i, /fan/i, /scrubber/i, /inventory/i],
    mimes: []
  },
  {
    name: 'Correspondence',
    patterns: [/email/i, /letter/i, /correspondence/i, /notice/i, /denial/i],
    mimes: []
  }
]

// ── Storage ─────────────────────────────────────────────────────────

function loadJobs() {
  try {
    if (fs.existsSync(JOBS_FILE)) {
      return JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'))
    }
  } catch (err) {
    console.error('[DocPackager] Failed to load jobs:', err.message)
  }
  return { nextId: 1, jobs: [] }
}

function loadDisputes() {
  try {
    if (fs.existsSync(DISPUTES_FILE)) {
      return JSON.parse(fs.readFileSync(DISPUTES_FILE, 'utf-8'))
    }
  } catch (err) {
    console.error('[DocPackager] Failed to load disputes:', err.message)
  }
  return { disputes: [] }
}

function saveDisputes(data) {
  fs.writeFileSync(DISPUTES_FILE, JSON.stringify(data, null, 2))
}

function findJob(jobId) {
  const data = loadJobs()
  const upper = jobId.toUpperCase()
  return data.jobs.find(j => {
    if (j.id === upper) return true
    const num = parseInt(jobId, 10)
    if (!isNaN(num) && j.id === `FD-${String(num).padStart(3, '0')}`) return true
    return false
  })
}

function normalizeJobId(jobId) {
  const upper = jobId.toUpperCase()
  if (upper.startsWith('FD-')) return upper
  const num = parseInt(jobId, 10)
  if (!isNaN(num)) return `FD-${String(num).padStart(3, '0')}`
  return upper
}

// ── Google Drive ────────────────────────────────────────────────────

function listDriveFiles(folderId) {
  try {
    const raw = execSync(
      `${GWS} drive files list --params '{"q": "'"'"'${folderId}'"'"' in parents and trashed = false", "fields": "files(id,name,mimeType,size,webViewLink,modifiedTime)", "pageSize": "100"}'`,
      { encoding: 'utf-8', timeout: 30000 }
    )
    // gws may print a keyring backend message — find JSON start
    const jsonStart = raw.indexOf('{')
    if (jsonStart === -1) {
      console.error('[DocPackager] No JSON in Drive response:', raw.substring(0, 200))
      return []
    }
    const parsed = JSON.parse(raw.slice(jsonStart))
    return parsed.files || []
  } catch (err) {
    console.error('[DocPackager] Drive list failed:', err.message)
    return []
  }
}

// ── Categorization ──────────────────────────────────────────────────

function categorizeFile(file) {
  const name = file.name || ''
  const mime = file.mimeType || ''

  for (const cat of CATEGORIES) {
    // Check name patterns
    for (const pattern of cat.patterns) {
      if (pattern.test(name)) return cat.name
    }
    // Check mime types
    for (const m of cat.mimes) {
      if (mime === m || mime.startsWith(m.split('/')[0] + '/')) {
        // Only match if the specific mime is listed
        if (cat.mimes.includes(mime)) return cat.name
      }
    }
  }

  return 'Other Documents'
}

function formatFileSize(sizeStr) {
  const bytes = parseInt(sizeStr || '0', 10)
  if (bytes === 0) return ''
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function formatDate(isoStr) {
  if (!isoStr) return ''
  return new Date(isoStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  })
}

// ── Package Builder ─────────────────────────────────────────────────

function buildPackageList(job, files) {
  // Categorize all files
  const categories = {}
  for (const file of files) {
    const cat = categorizeFile(file)
    if (!categories[cat]) categories[cat] = []
    categories[cat].push(file)
  }

  const lines = [
    `*Document Package — ${job.id}*`,
    `Client: ${job.client}`,
    job.address ? `Address: ${job.address}${job.city ? ', ' + job.city : ''}` : '',
    `Drive: ${job.driveUrl || 'N/A'}`,
    `Total files: ${files.length}`,
    ''
  ].filter(Boolean)

  // Show categories in defined order, then "Other Documents" last
  const orderedCats = CATEGORIES.map(c => c.name)
  orderedCats.push('Other Documents')

  for (const catName of orderedCats) {
    const catFiles = categories[catName]
    if (!catFiles || catFiles.length === 0) continue

    lines.push(`--- ${catName.toUpperCase()} (${catFiles.length}) ---`)
    for (const f of catFiles) {
      const size = formatFileSize(f.size)
      const date = formatDate(f.modifiedTime)
      let line = `  ${f.name}`
      if (size) line += ` (${size})`
      if (date) line += ` — ${date}`
      lines.push(line)
    }
    lines.push('')
  }

  lines.push(`Use /package ${job.id} send <email> to send this package`)
  return lines.join('\n')
}

// ── Package Email ───────────────────────────────────────────────────

function buildPackageEmail(job, files) {
  const categories = {}
  for (const file of files) {
    const cat = categorizeFile(file)
    if (!categories[cat]) categories[cat] = []
    categories[cat].push(file)
  }

  const orderedCats = CATEGORIES.map(c => c.name)
  orderedCats.push('Other Documents')

  const subject = `Document Package: ${job.client} — ${job.id}`

  const bodyParts = [
    'Please find the complete document package for the following claim:',
    '',
    `Client: ${job.client}`,
    job.address ? `Property: ${job.address}${job.city ? ', ' + job.city : ''}` : '',
    `Reference: ${job.id}`,
    '',
    `Complete folder: ${job.driveUrl || 'Available upon request'}`,
    '',
    '--- DOCUMENT INDEX ---',
    ''
  ].filter(Boolean)

  for (const catName of orderedCats) {
    const catFiles = categories[catName]
    if (!catFiles || catFiles.length === 0) continue

    bodyParts.push(`${catName} (${catFiles.length}):`)
    for (const f of catFiles) {
      const link = f.webViewLink || ''
      if (link) {
        bodyParts.push(`  - ${f.name}: ${link}`)
      } else {
        bodyParts.push(`  - ${f.name}`)
      }
    }
    bodyParts.push('')
  }

  bodyParts.push(
    `Total documents: ${files.length}`,
    '',
    'All documents referenced above are available in the shared Google Drive folder linked above. Please review and confirm receipt.',
    '',
    'If you require any additional documentation, please do not hesitate to contact me.',
    '',
    'Respectfully,',
    'Frank Darakhshan',
    'President, Flood Doctor LLC',
    'Phone: (703) 498-1581',
    'Email: frank@flood.doctor'
  )

  return { subject, body: bodyParts.join('\n') }
}

function sendPackageEmail(toEmail, subject, body) {
  try {
    const escapedSubject = subject.replace(/'/g, "'\\''")
    const escapedBody = body.replace(/'/g, "'\\''")
    const escapedTo = toEmail.replace(/'/g, "'\\''")

    const cmd = `${GWS_WORK} gmail messages send --to '${escapedTo}' --subject '${escapedSubject}' --body '${escapedBody}'`

    const result = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 30000
    })

    console.log(`[DocPackager] Email sent to ${toEmail}: ${result.trim().substring(0, 100)}`)
    return { success: true, output: result.trim() }
  } catch (err) {
    console.error(`[DocPackager] Email send failed:`, err.message)
    return { success: false, error: err.message }
  }
}

// ── Command Handlers ────────────────────────────────────────────────

function handlePackageList(jobId) {
  const job = findJob(jobId)
  if (!job) {
    return { handled: true, response: `Job not found: ${jobId}` }
  }

  if (!job.driveFolderId) {
    return {
      handled: true,
      response: `${job.id} (${job.client}) has no Google Drive folder linked.\nCannot build document package without a Drive folder.`
    }
  }

  const files = listDriveFiles(job.driveFolderId)
  if (files.length === 0) {
    return {
      handled: true,
      response: `No files found in Drive folder for ${job.id} (${job.client}).\nFolder: ${job.driveUrl || job.driveFolderId}`
    }
  }

  return { handled: true, response: buildPackageList(job, files) }
}

function handlePackageSend(jobId, email) {
  if (!email || !email.includes('@')) {
    return {
      handled: true,
      response: 'Usage: /package <job-id> send <email>\nExample: /package FD-002 send adjuster@statefarm.com'
    }
  }

  const job = findJob(jobId)
  if (!job) {
    return { handled: true, response: `Job not found: ${jobId}` }
  }

  if (!job.driveFolderId) {
    return {
      handled: true,
      response: `${job.id} has no Google Drive folder linked.`
    }
  }

  const files = listDriveFiles(job.driveFolderId)
  if (files.length === 0) {
    return {
      handled: true,
      response: `No files in Drive folder for ${job.id}. Nothing to package.`
    }
  }

  const { subject, body } = buildPackageEmail(job, files)
  const result = sendPackageEmail(email, subject, body)

  if (result.success) {
    // Record in dispute timeline if there's an open dispute
    const disputeData = loadDisputes()
    const nid = normalizeJobId(jobId)
    const dispute = disputeData.disputes.find(d => d.jobId === nid && d.status === 'open')
    if (dispute) {
      const now = new Date().toISOString()
      dispute.lastActivityAt = now
      dispute.timeline.push({
        type: 'doc-sent',
        description: `Document package (${files.length} files) sent to ${email}`,
        date: now
      })
      saveDisputes(disputeData)
    }

    return {
      handled: true,
      response: [
        `Document package SENT for *${job.id}* — ${job.client}`,
        `To: ${email}`,
        `Files: ${files.length}`,
        `Subject: ${subject}`,
        '',
        dispute ? 'Dispute timeline updated with doc-sent event.' : ''
      ].filter(Boolean).join('\n')
    }
  }

  return {
    handled: true,
    response: `Failed to send package for ${job.id}: ${result.error}\n\nTry again with /package ${job.id} send ${email}`
  }
}

function packageHelp() {
  return {
    handled: true,
    response: [
      '*Document Package Builder*',
      '',
      '/package <job-id> — list all files categorized',
      '/package <job-id> send <email> — send package email with doc links',
      '',
      'Categories: scope sheets, moisture logs, labor logs, photos,',
      'invoices, contracts, testing reports, equipment, correspondence',
      '',
      'Example:',
      '/package FD-002',
      '/package FD-002 send adjuster@statefarm.com'
    ].join('\n')
  }
}

// ── Main Router ─────────────────────────────────────────────────────

function routePackageCommand(text) {
  const trimmed = text.trim()
  const lower = trimmed.toLowerCase()

  if (!lower.startsWith('/package')) return null

  const rest = trimmed.slice(8).trim()
  if (!rest) return packageHelp()

  // Parse: <job-id> [send <email>]
  const parts = rest.split(/\s+/)
  const jobId = parts[0]

  if (parts.length === 1) {
    // /package <job-id> — list files
    return handlePackageList(jobId)
  }

  if (parts[1].toLowerCase() === 'send' && parts.length >= 3) {
    // /package <job-id> send <email>
    return handlePackageSend(jobId, parts[2])
  }

  // Unknown subcommand
  return handlePackageList(jobId)
}

// ── Plugin Registration ─────────────────────────────────────────────

export function register(gateway) {
  const originalExecute = gateway.commandHandler.execute.bind(gateway.commandHandler)

  gateway.commandHandler.execute = async function (text, sessionKey, adapter, chatId) {
    const lower = text.trim().toLowerCase()

    if (lower.startsWith('/package')) {
      const result = routePackageCommand(text)
      if (result) return result
    }

    return originalExecute(text, sessionKey, adapter, chatId)
  }

  // Extend /help
  const originalHelp = gateway.commandHandler.handleHelp.bind(gateway.commandHandler)

  gateway.commandHandler.handleHelp = function () {
    const result = originalHelp()
    const lines = [
      '',
      '--- Doc Packager ---',
      '/package <job-id> — list files categorized',
      '/package <job-id> send <email> — send package'
    ]
    result.response += '\n' + lines.join('\n')
    return result
  }

  console.log('[DocPackager] Loaded — /package command enabled')
}
