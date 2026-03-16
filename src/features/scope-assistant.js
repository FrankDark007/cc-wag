import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

/**
 * Scope Assistant Feature
 * Analyzes project files from Google Drive and produces structured Xactimate line items
 * for water damage restoration invoicing.
 *
 * Commands:
 *   /scope <job-id-or-name> — Full scope analysis
 *   /scope list             — Show jobs that have Drive folders linked
 *
 * Flow:
 *   1. Look up job in workspace/jobs.json (by ID or client name)
 *   2. Get the job's Google Drive folder ID
 *   3. List all files in that Drive folder via gws CLI
 *   4. Download PDFs and relevant docs to workspace/scope-temp/<job-id>/
 *   5. Send a detailed analysis prompt to the agent pipeline
 *   6. Agent reads the files with its Read tool and responds via WhatsApp
 *
 * Storage: workspace/scope-temp/ (cleaned up after analysis)
 */

const GWS = '/opt/homebrew/bin/gws'
const JOBS_FILE = '/Users/ghost/Projects/cc-wag/workspace/jobs.json'
const SCOPE_TEMP_DIR = '/Users/ghost/Projects/cc-wag/workspace/scope-temp'
const FRANK_CHAT_ID = '17034981581@s.whatsapp.net'

// File types we care about for scope analysis
const RELEVANT_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
  'application/vnd.ms-excel', // xls
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'application/msword', // doc
  'text/plain',
  'text/csv',
  'image/jpeg',
  'image/png',
]

// Google Docs export mime types
const GOOGLE_DOC_EXPORTS = {
  'application/vnd.google-apps.document': {
    exportMime: 'application/pdf',
    ext: '.pdf'
  },
  'application/vnd.google-apps.spreadsheet': {
    exportMime: 'text/csv',
    ext: '.csv'
  },
}

// ── Storage ─────────────────────────────────────────────────────────

function loadJobs() {
  try {
    if (fs.existsSync(JOBS_FILE)) {
      return JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'))
    }
  } catch (err) {
    console.error('[ScopeAssistant] Failed to load jobs:', err.message)
  }
  return { nextId: 1, jobs: [] }
}

function findJobByIdOrName(query) {
  const data = loadJobs()
  const q = query.trim()
  const qUpper = q.toUpperCase()
  const qLower = q.toLowerCase()

  // Try exact ID match first (FD-002, fd-002, 002, 2)
  for (const job of data.jobs) {
    if (job.id === qUpper) return job
    const num = parseInt(q, 10)
    if (!isNaN(num) && job.id === `FD-${String(num).padStart(3, '0')}`) return job
  }

  // Try client name search (partial, case-insensitive)
  const nameMatches = data.jobs.filter(j =>
    j.client && j.client.toLowerCase().includes(qLower)
  )

  if (nameMatches.length === 1) return nameMatches[0]
  if (nameMatches.length > 1) {
    // Return the first match but log ambiguity
    console.log(`[ScopeAssistant] Ambiguous name "${q}" matched ${nameMatches.length} jobs, using first: ${nameMatches[0].id}`)
    return nameMatches[0]
  }

  return null
}

// ── Google Drive ────────────────────────────────────────────────────

function listDriveFiles(folderId) {
  try {
    const raw = execSync(
      `${GWS} drive files list --params '{"q": "'"'"'${folderId}'"'"' in parents and trashed = false", "fields": "files(id,name,mimeType,size)", "pageSize": "100"}'`,
      { encoding: 'utf-8', timeout: 30000 }
    )
    // gws may print a keyring backend message on the first line — find JSON start
    const jsonStart = raw.indexOf('{')
    if (jsonStart === -1) {
      console.error('[ScopeAssistant] No JSON in Drive response:', raw.substring(0, 200))
      return { files: [] }
    }
    return JSON.parse(raw.slice(jsonStart))
  } catch (err) {
    console.error('[ScopeAssistant] Drive list failed:', err.message)
    return { files: [] }
  }
}

function downloadDriveFile(fileId, outputPath, timeoutMs = 60000) {
  try {
    execSync(
      `${GWS} drive files get --params '{"fileId": "${fileId}", "alt": "media"}' -o "${outputPath}"`,
      { encoding: 'utf-8', timeout: timeoutMs }
    )
    return true
  } catch (err) {
    console.error(`[ScopeAssistant] Download failed for ${fileId}:`, err.message)
    return false
  }
}

function exportGoogleDoc(fileId, mimeType, outputPath, timeoutMs = 60000) {
  try {
    execSync(
      `${GWS} drive files export --params '{"fileId": "${fileId}", "mimeType": "${mimeType}"}' -o "${outputPath}"`,
      { encoding: 'utf-8', timeout: timeoutMs }
    )
    return true
  } catch (err) {
    console.error(`[ScopeAssistant] Export failed for ${fileId}:`, err.message)
    return false
  }
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 100)
}

// ── File Download Orchestrator ──────────────────────────────────────

function downloadJobFiles(job) {
  const jobDir = path.join(SCOPE_TEMP_DIR, job.id)

  // Create temp directory
  if (!fs.existsSync(jobDir)) {
    fs.mkdirSync(jobDir, { recursive: true })
  }

  // List files in the Drive folder
  const result = listDriveFiles(job.driveFolderId)
  const files = result.files || []

  if (files.length === 0) {
    return { dir: jobDir, downloaded: [], skipped: [], error: null }
  }

  const downloaded = []
  const skipped = []

  for (const file of files) {
    const mime = file.mimeType || ''
    const name = file.name || 'unnamed'
    const fileId = file.id

    // Handle Google Docs (need export)
    if (GOOGLE_DOC_EXPORTS[mime]) {
      const exportInfo = GOOGLE_DOC_EXPORTS[mime]
      const safeName = sanitizeFilename(name) + exportInfo.ext
      const outputPath = path.join(jobDir, safeName)

      console.log(`[ScopeAssistant] Exporting Google Doc: ${name} -> ${safeName}`)
      if (exportGoogleDoc(fileId, exportInfo.exportMime, outputPath)) {
        downloaded.push({ name, path: outputPath, originalMime: mime, exportedAs: exportInfo.exportMime })
      } else {
        skipped.push({ name, reason: 'export failed' })
      }
      continue
    }

    // Handle regular files
    const isRelevant = RELEVANT_MIME_TYPES.some(t => mime.startsWith(t.split('/')[0]) || mime === t)
    if (!isRelevant) {
      // Still download unknown file types — they might be useful
      // Only skip Google Apps types we can't export
      if (mime.startsWith('application/vnd.google-apps.')) {
        skipped.push({ name, reason: `unsupported Google type: ${mime}` })
        continue
      }
    }

    // Skip very large files (>50MB)
    const sizeBytes = parseInt(file.size || '0', 10)
    if (sizeBytes > 50 * 1024 * 1024) {
      skipped.push({ name, reason: `too large (${Math.round(sizeBytes / 1024 / 1024)}MB)` })
      continue
    }

    const ext = path.extname(name) || mimeToExt(mime)
    const safeName = sanitizeFilename(path.basename(name, ext)) + ext
    const outputPath = path.join(jobDir, safeName)

    console.log(`[ScopeAssistant] Downloading: ${name} (${mime})`)
    if (downloadDriveFile(fileId, outputPath)) {
      downloaded.push({ name, path: outputPath, mime })
    } else {
      skipped.push({ name, reason: 'download failed' })
    }
  }

  return { dir: jobDir, downloaded, skipped, error: null }
}

function mimeToExt(mime) {
  const map = {
    'application/pdf': '.pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/msword': '.doc',
    'text/plain': '.txt',
    'text/csv': '.csv',
    'image/jpeg': '.jpg',
    'image/png': '.png',
  }
  return map[mime] || ''
}

// ── Cleanup ─────────────────────────────────────────────────────────

function cleanupJobDir(jobId) {
  const jobDir = path.join(SCOPE_TEMP_DIR, jobId)
  try {
    if (fs.existsSync(jobDir)) {
      fs.rmSync(jobDir, { recursive: true, force: true })
      console.log(`[ScopeAssistant] Cleaned up ${jobDir}`)
    }
  } catch (err) {
    console.error(`[ScopeAssistant] Cleanup failed for ${jobDir}:`, err.message)
  }
}

// ── Analysis Prompt ─────────────────────────────────────────────────

function buildAnalysisPrompt(job, downloadResult) {
  const { dir, downloaded, skipped } = downloadResult

  const fileList = downloaded.map(f => `  - ${f.name} -> ${f.path}`).join('\n')
  const skipList = skipped.length > 0
    ? '\nSkipped files:\n' + skipped.map(s => `  - ${s.name}: ${s.reason}`).join('\n')
    : ''

  return `You are an Xactimate scope analysis expert for water damage restoration, working to IICRC S500/S520 standards. Frank needs you to analyze all project documents for job ${job.id} (${job.client}) and produce a structured line item list for Xactimate entry.

IMPORTANT: Read EVERY file in the directory ${dir} using your Read tool. For PDF files, use your Read tool directly — it can read PDFs. For XLSX/CSV files, read them as well. For images, view them with the Read tool (you have vision). Read ALL files before starting your analysis.

Files downloaded from the project's Google Drive folder:
${fileList}
${skipList}

JOB INFO:
- Job ID: ${job.id}
- Client: ${job.client}
- Address: ${job.address || 'Not specified'}${job.city ? ', ' + job.city : ''}
- Status: ${job.status}
- Drive Folder: ${job.driveUrl || 'N/A'}

ANALYSIS INSTRUCTIONS:

After reading ALL documents, produce a STRUCTURED Xactimate line item list organized into these categories. For each line item include: Xactimate code (if known), description, quantity, unit (SF/LF/EA/HR/DY), and room/area.

CATEGORIES TO COVER:

1. EQUIPMENT
   Air movers, dehumidifiers, air scrubbers, generators, heaters, axial fans, negative air machines
   Format: qty x days per room
   Codes: WTREQUP, WTRDHU, etc.

2. DEMOLITION
   Drywall tearout/flood cuts, insulation removal, baseboard removal, flooring removal
   Format: SF/LF per room
   Codes: WLL-004, INS-001, FLR-014, etc.

3. LABOR
   Setup, daily monitoring visits, takedown, decontamination labor
   Format: hours, with normal vs after-hours/weekend/holiday breakdown
   Codes: CLG-001, GNL-001, etc.

4. SUPERVISORY
   Supervisory hours from labor log or monitoring reports
   Format: hours

5. PPE
   Per tech per day, Cat 2/3 requirements (Tyvek suits, respirators, gloves, booties)
   Format: per tech per day count

6. TESTING
   Asbestos testing, mold testing, moisture readings
   Format: actual costs if available, otherwise EA
   Codes: TST-ASBST, TST-MOLD, etc.

7. DEBRIS REMOVAL
   Truck loads, dumpster, disposal fees
   Format: loads or CY

8. CONTENTS MANIPULATION
   Move-out, move-back, protective covering, content cleaning
   Format: SF for covering, hours for moving

9. APPLIANCES
   Detach, clean, wrap, reset appliances
   Format: EA per appliance

10. FLOORING
    Tearout (carpet, vinyl, tile, hardwood), HEPA vacuum subfloor, antimicrobial on subfloor
    Format: SF per room
    Codes: FLR-*, CLN-HEPA, etc.

11. ANTIMICROBIAL
    Pre-demo application, post-dry application
    Format: SF per room per application
    Codes: ANT-001, etc.

12. FINAL CLEANING
    Wipe-down, HEPA vacuum, detail clean

13. MISCELLANEOUS
    Anything that doesn't fit above

CRITICAL — FLAG THESE SECTIONS:

CORRECTIONS: Items that differ between the original scope sheet and any updated/corrected reports. Show what changed and why.

ADDITIONS: Items found in demo reports, labor logs, or field notes that were NOT in the original scope. These are revenue that would be lost if missed.

ITEMS NEEDING CLARIFICATION: Missing measurements, unresolved quantities, conflicting information between documents, rooms without dimensions.

FORMAT RULES:
- Group by category with clear headers
- Include room/area for every line item
- Show quantities with units
- Include Xactimate code where known
- Flag discrepancies prominently
- At the end, provide a brief summary of total scope (number of rooms, water damage category/class per IICRC, estimated line item count)

This is for a real invoice — accuracy matters. Cross-reference ALL documents against each other. Do not make up quantities — if a measurement is missing, flag it.

After completing the analysis, note: the temp files in ${dir} can be cleaned up.`
}

// ── Scope List ──────────────────────────────────────────────────────

function handleScopeList() {
  const data = loadJobs()
  const withDrive = data.jobs.filter(j => j.driveFolderId)

  if (withDrive.length === 0) {
    return {
      handled: true,
      response: 'No jobs have Drive folders linked. Use the job importer to set up driveFolderId on jobs.'
    }
  }

  const lines = [`*Jobs with Drive Folders* (${withDrive.length})`, '']

  // Group by status
  const needsInvoice = withDrive.filter(j => j.status === 'needs-invoice')
  const other = withDrive.filter(j => j.status !== 'needs-invoice')

  if (needsInvoice.length > 0) {
    lines.push(`--- NEEDS INVOICE (${needsInvoice.length}) ---`)
    for (const j of needsInvoice) {
      lines.push(`${j.id} | ${j.client} | /scope ${j.id}`)
    }
    lines.push('')
  }

  if (other.length > 0) {
    lines.push(`--- OTHER (${other.length}) ---`)
    for (const j of other.slice(0, 20)) {
      lines.push(`${j.id} | ${j.client} | ${j.status}`)
    }
    if (other.length > 20) {
      lines.push(`... +${other.length - 20} more`)
    }
  }

  return { handled: true, response: lines.join('\n') }
}

// ── Main Scope Command ──────────────────────────────────────────────

async function handleScope(query, gateway, adapter, chatId, sessionKey) {
  // Look up the job
  const job = findJobByIdOrName(query)
  if (!job) {
    return {
      handled: true,
      response: `Job not found: "${query}"\n\nTry /scope list to see available jobs, or use a job ID like /scope FD-002`
    }
  }

  // Check for Drive folder
  if (!job.driveFolderId) {
    return {
      handled: true,
      response: `${job.id} (${job.client}) has no Google Drive folder linked.\n\nAdd a driveFolderId to this job first.`
    }
  }

  // Send acknowledgment
  await adapter.sendMessage(chatId,
    `Analyzing scope for *${job.id}* — ${job.client}\n\nDownloading project files from Drive...`
  )

  // Download files
  console.log(`[ScopeAssistant] Starting scope analysis for ${job.id} (${job.client})`)
  const downloadResult = downloadJobFiles(job)

  if (downloadResult.downloaded.length === 0) {
    cleanupJobDir(job.id)
    return {
      handled: true,
      response: `No downloadable files found in the Drive folder for ${job.id} (${job.client}).\n\nFolder: ${job.driveUrl || job.driveFolderId}`
    }
  }

  // Notify about download results
  const dlMsg = [
    `Downloaded ${downloadResult.downloaded.length} file(s) for ${job.id}:`,
    ...downloadResult.downloaded.map(f => `  ${f.name}`),
  ]
  if (downloadResult.skipped.length > 0) {
    dlMsg.push(`\nSkipped ${downloadResult.skipped.length}: ${downloadResult.skipped.map(s => s.name).join(', ')}`)
  }
  dlMsg.push('\nRunning Xactimate scope analysis...')
  await adapter.sendMessage(chatId, dlMsg.join('\n'))

  // Build analysis prompt and send through the agent pipeline
  const analysisPrompt = buildAnalysisPrompt(job, downloadResult)

  // Enqueue the analysis as an agent run — this uses the full streaming pipeline
  // so the response will be sent back via WhatsApp automatically
  try {
    await gateway.agentRunner.enqueueRun(
      sessionKey,
      analysisPrompt,
      adapter,
      chatId
    )
  } catch (err) {
    console.error(`[ScopeAssistant] Agent analysis failed for ${job.id}:`, err.message)
    await adapter.sendMessage(chatId,
      `Scope analysis failed for ${job.id}: ${err.message}\n\nFiles are still available at ${downloadResult.dir} for manual review.`
    )
  }

  // Schedule cleanup after a delay (give the agent time to read files)
  // The agent reads files during its run, so we wait 5 minutes before cleanup
  setTimeout(() => {
    cleanupJobDir(job.id)
  }, 5 * 60 * 1000)

  return { handled: true, response: '' }
}

// ── Command Router ──────────────────────────────────────────────────

function routeScopeCommand(text) {
  const trimmed = text.trim()
  const lower = trimmed.toLowerCase()

  if (!lower.startsWith('/scope')) return null

  // Strip "/scope" prefix
  const rest = trimmed.slice(6).trim()
  const restLower = rest.toLowerCase()

  // /scope (no args) — show help
  if (!rest) return scopeHelp()

  // /scope list
  if (restLower === 'list') return handleScopeList()

  // /scope <query> — needs async handling, return the query
  return { needsAsync: true, query: rest }
}

function scopeHelp() {
  return {
    handled: true,
    response: [
      '*Scope Assistant Commands*',
      '',
      '/scope <job-id> — Analyze project files for Xactimate line items',
      '/scope <client-name> — Search by client name',
      '/scope list — Show jobs with Drive folders linked',
      '',
      'Examples:',
      '/scope FD-002',
      '/scope Wigenton',
      '/scope 2',
    ].join('\n')
  }
}

// ── Plugin Registration ─────────────────────────────────────────────

export function register(gateway) {
  // Ensure temp directory exists
  if (!fs.existsSync(SCOPE_TEMP_DIR)) {
    fs.mkdirSync(SCOPE_TEMP_DIR, { recursive: true })
  }

  // Wrap the command handler to intercept /scope before default routing
  const originalExecute = gateway.commandHandler.execute.bind(gateway.commandHandler)

  gateway.commandHandler.execute = async function (text, sessionKey, adapter, chatId) {
    const lower = text.trim().toLowerCase()

    if (lower.startsWith('/scope')) {
      const result = routeScopeCommand(text)

      if (result && result.needsAsync) {
        // Async scope analysis — handle it directly
        return await handleScope(result.query, gateway, adapter, chatId, sessionKey)
      }

      if (result) return result
    }

    return originalExecute(text, sessionKey, adapter, chatId)
  }

  // Extend /help output
  const originalHelp = gateway.commandHandler.handleHelp.bind(gateway.commandHandler)

  gateway.commandHandler.handleHelp = function () {
    const result = originalHelp()
    const scopeLines = [
      '',
      '--- Scope Assistant ---',
      '/scope <job-id-or-name> — Xactimate scope analysis',
      '/scope list — Jobs with Drive folders'
    ]
    result.response += '\n' + scopeLines.join('\n')
    return result
  }

  console.log('[ScopeAssistant] Loaded — /scope command enabled')
}
