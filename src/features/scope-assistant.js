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
 *   /scope <job-id> template <template-key> — Analysis with specific IICRC template
 *   /scope list             — Show jobs that have Drive folders linked
 *   /xact search <term>     — Search Xactimate line items by code or description
 *   /xact templates         — List available scope templates
 *
 * Flow:
 *   1. Look up job in workspace/jobs.json (by ID or client name)
 *   2. Get the job's Google Drive folder ID
 *   3. List all files in that Drive folder via gws CLI
 *   4. Download PDFs and relevant docs to workspace/scope-temp/<job-id>/
 *   5. Send a detailed analysis prompt to the agent pipeline (with KB context)
 *   6. Agent reads the files with its Read tool and responds via WhatsApp
 *
 * Storage: workspace/scope-temp/ (cleaned up after analysis)
 */

import config from '../config.js'

const GWS = config.paths.gwsBin
const JOBS_FILE = config.paths.jobsFile
const SCOPE_TEMP_DIR = config.paths.scopeTempDir
const KB_DIR = config.paths.xactimateKbDir
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

// ── Knowledge Base ──────────────────────────────────────────────────

let _kb = null

function loadKB() {
  const kb = {}
  for (const file of ['line-items.json', 'scope-templates.json', 'equipment-mapping.json', 'pushback-responses.json']) {
    try {
      kb[file.replace('.json', '').replace(/-/g, '_')] = JSON.parse(fs.readFileSync(path.join(KB_DIR, file), 'utf-8'))
    } catch { /* skip if missing */ }
  }
  return kb
}

function getKB() {
  if (!_kb) _kb = loadKB()
  return _kb
}

// ── Rate Calculator ─────────────────────────────────────────────────

/**
 * Given a Date object, return the rate multiplier and label.
 * Uses equipment-mapping.json rateMultipliers and holidays list.
 */
function getRateMultiplier(dateTime) {
  const kb = getKB()
  const mapping = kb.equipment_mapping || {}
  const multipliers = mapping.rateMultipliers || {}
  const holidays = mapping.holidays2026 || []

  const d = dateTime instanceof Date ? dateTime : new Date(dateTime)

  // Format date as YYYY-MM-DD for holiday check
  const dateStr = d.toISOString().split('T')[0]
  const dayOfWeek = d.getDay() // 0=Sun, 6=Sat
  const hour = d.getHours()

  // Holiday check first (highest priority alongside Sunday)
  if (holidays.includes(dateStr)) {
    const entry = multipliers.holiday || { label: 'Holiday', multiplier: 2.0 }
    return { multiplier: entry.multiplier, label: entry.label }
  }

  // Sunday
  if (dayOfWeek === 0) {
    const entry = multipliers.sunday || { label: 'Sunday', multiplier: 2.0 }
    return { multiplier: entry.multiplier, label: entry.label }
  }

  // Saturday
  if (dayOfWeek === 6) {
    const entry = multipliers.saturday || { label: 'Saturday', multiplier: 1.5 }
    return { multiplier: entry.multiplier, label: entry.label }
  }

  // Weekday: business hours = 7am-6pm
  if (hour >= 7 && hour < 18) {
    const entry = multipliers.businessHours || { label: 'Business Hours (7am-6pm M-F)', multiplier: 1.0 }
    return { multiplier: entry.multiplier, label: entry.label }
  }

  // Weekday after hours
  const entry = multipliers.afterHours || { label: 'After Hours (6pm-7am M-F)', multiplier: 1.5 }
  return { multiplier: entry.multiplier, label: entry.label }
}

/**
 * Given an array of timestamp strings (e.g., from CompanyCam),
 * calculate hours and rate breakdown.
 */
function calculateRateBreakdown(timestamps) {
  if (!timestamps || timestamps.length < 2) return null

  const sorted = timestamps.map(t => new Date(t)).sort((a, b) => a - b)
  const results = []

  for (let i = 0; i < sorted.length - 1; i += 2) {
    const start = sorted[i]
    const end = sorted[i + 1] || sorted[i]
    const hours = (end - start) / (1000 * 60 * 60)
    const rate = getRateMultiplier(start)

    results.push({
      start: start.toISOString(),
      end: end.toISOString(),
      hours: Math.round(hours * 100) / 100,
      multiplier: rate.multiplier,
      label: rate.label
    })
  }

  return results
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

// ── KB-Enhanced Analysis Prompt ─────────────────────────────────────

function buildKBContext(templateKey) {
  const kb = getKB()
  const sections = []

  // Build line items reference
  if (kb.line_items) {
    const allItems = []
    for (const [catKey, cat] of Object.entries(kb.line_items.categories || {})) {
      for (const item of cat.items || []) {
        allItems.push(`  ${item.code} | ${item.description} | ${item.unit}${item.notes ? ' | ' + item.notes : ''}`)
      }
    }
    if (allItems.length > 0) {
      sections.push(`XACTIMATE CODE REFERENCE (use these exact codes in your output):\n${allItems.join('\n')}`)
    }
  }

  // Build equipment alias mapping
  if (kb.equipment_mapping) {
    const mappingLines = (kb.equipment_mapping.mappings || []).map(m =>
      `  ${m.aliases.join(', ')} -> ${m.code} (${m.description}, ${m.unit})`
    )
    if (mappingLines.length > 0) {
      sections.push(`EQUIPMENT NAME-TO-CODE MAPPING:\nWhen you see these terms in documents, map them to the Xactimate code:\n${mappingLines.join('\n')}`)
    }
  }

  // Include specific template if requested
  if (templateKey && kb.scope_templates) {
    const template = kb.scope_templates.templates[templateKey]
    if (template) {
      const templateItems = template.typicalItems.join(', ')
      sections.push(`SCOPE TEMPLATE APPLIED: ${template.name}
Description: ${template.description}
Standard Drying Days: ${template.standardDryingDays}
Equipment Ratio: ${template.equipmentRatio}
Typical Line Items: ${templateItems}
Notes: ${template.notes}

IMPORTANT: Use this template as a baseline. The typical items listed above should ALL be present unless documents explicitly indicate otherwise. Flag any missing items from this template as potential additions.`)
    }
  }

  // Include pushback context
  if (kb.pushback_responses) {
    sections.push(`ADJUSTER PUSHBACK AWARENESS:
When writing the scope, be aware of common adjuster objections and ensure documentation supports each line item. Key areas adjusters challenge:
${(kb.pushback_responses.responses || []).map(r => `  - ${r.adjusterClaim} (defend with: ${r.references.join(', ')})`).join('\n')}`)
  }

  return sections.length > 0 ? '\n\n--- XACTIMATE KNOWLEDGE BASE ---\n\n' + sections.join('\n\n') : ''
}

function buildAnalysisPrompt(job, downloadResult, templateKey) {
  const { dir, downloaded, skipped } = downloadResult

  const fileList = downloaded.map(f => `  - ${f.name} -> ${f.path}`).join('\n')
  const skipList = skipped.length > 0
    ? '\nSkipped files:\n' + skipped.map(s => `  - ${s.name}: ${s.reason}`).join('\n')
    : ''

  const kbContext = buildKBContext(templateKey)

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
${templateKey ? `- Template Applied: ${templateKey}` : ''}
${kbContext}

ANALYSIS INSTRUCTIONS:

After reading ALL documents, produce a STRUCTURED Xactimate line item list organized into these categories. For each line item include: Xactimate code (use codes from the KB reference above), description, quantity, unit (SF/LF/EA/HR/DY), and room/area.

CATEGORIES TO COVER:

1. EQUIPMENT
   Air movers, dehumidifiers, air scrubbers, generators, heaters, axial fans, negative air machines
   Format: qty x days per room
   Codes: WTREQUP, WTRDHU, WTRFAN, WTRAHR, WTRHTR

2. DEMOLITION
   Drywall tearout/flood cuts, insulation removal, baseboard removal, flooring removal
   Format: SF/LF per room
   Codes: DRYRMV, BSBRMV, CPTRMV, PADRMV, FLRRMV, CABRMV, INSLRMV

3. LABOR
   Setup, daily monitoring visits, takedown, decontamination labor
   Format: hours, with normal vs after-hours/weekend/holiday breakdown
   Codes: LABMIN, LABGEN, LABTCH, LABSUP

4. SUPERVISORY
   Supervisory hours from labor log or monitoring reports
   Format: hours
   Codes: LABSUP

5. PPE
   Per tech per day, Cat 2/3 requirements (Tyvek suits, respirators, gloves, booties)
   Format: per tech per day count

6. TESTING
   Asbestos testing, mold testing, moisture readings
   Format: actual costs if available, otherwise EA
   Codes: WTRTST, WTRMON

7. DEBRIS REMOVAL
   Truck loads, dumpster, disposal fees
   Format: loads or CY

8. CONTENTS MANIPULATION
   Move-out, move-back, protective covering, content cleaning
   Format: SF for covering, hours for moving
   Codes: CNTMOV, CNTBLK, CNTPKO

9. APPLIANCES
   Detach, clean, wrap, reset appliances
   Format: EA per appliance

10. FLOORING
    Tearout (carpet, vinyl, tile, hardwood), HEPA vacuum subfloor, antimicrobial on subfloor
    Format: SF per room
    Codes: CPTRMV, PADRMV, FLRRMV, CPTINS, PADINS

11. ANTIMICROBIAL
    Pre-demo application, post-dry application
    Format: SF per room per application
    Codes: WTRAMT, WTRSNT

12. FINAL CLEANING
    Wipe-down, HEPA vacuum, detail clean

13. RECONSTRUCTION (if applicable)
    Drywall install/finish, baseboard, paint, flooring
    Codes: DRYINS, DRYFIN, BSBINS, PNTINT, PNTCLG, CPTINS, PADINS

14. EMERGENCY SERVICES (if applicable)
    Emergency call, board up, tarp
    Codes: EMGSVC, EMGBRD, TARPRF

15. MISCELLANEOUS
    Anything that doesn't fit above

CRITICAL — FLAG THESE SECTIONS:

CORRECTIONS: Items that differ between the original scope sheet and any updated/corrected reports. Show what changed and why.

ADDITIONS: Items found in demo reports, labor logs, or field notes that were NOT in the original scope. These are revenue that would be lost if missed.

ITEMS NEEDING CLARIFICATION: Missing measurements, unresolved quantities, conflicting information between documents, rooms without dimensions.

FORMAT RULES:
- Group by category with clear headers
- Include room/area for every line item
- Show quantities with units
- Include Xactimate code for every line item (use KB codes above)
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

// ── Xact Search ─────────────────────────────────────────────────────

function handleXactSearch(term) {
  const kb = getKB()
  if (!kb.line_items) {
    return { handled: true, response: 'Xactimate KB not loaded. Check workspace/xactimate-kb/line-items.json' }
  }

  const termLower = term.toLowerCase()
  const results = []

  // Search line items by code or description
  for (const [catKey, cat] of Object.entries(kb.line_items.categories || {})) {
    for (const item of cat.items || []) {
      if (
        item.code.toLowerCase().includes(termLower) ||
        item.description.toLowerCase().includes(termLower)
      ) {
        results.push(item)
      }
    }
  }

  // Also search equipment aliases
  if (kb.equipment_mapping) {
    for (const mapping of kb.equipment_mapping.mappings || []) {
      const aliasMatch = mapping.aliases.some(a => a.toLowerCase().includes(termLower))
      if (aliasMatch) {
        // Find the corresponding line item
        const existing = results.find(r => r.code === mapping.code)
        if (!existing) {
          results.push({ code: mapping.code, description: mapping.description, unit: mapping.unit, category: 'Equipment (alias match)' })
        }
      }
    }
  }

  if (results.length === 0) {
    return { handled: true, response: `No Xactimate items found for "${term}"` }
  }

  const lines = [`*Xactimate Search: "${term}"* (${results.length} result${results.length !== 1 ? 's' : ''})`, '']
  for (const item of results) {
    lines.push(`${item.code} | ${item.description} | ${item.unit} | ${item.category}`)
    if (item.notes) lines.push(`  _${item.notes}_`)
  }

  return { handled: true, response: lines.join('\n') }
}

// ── Xact Templates List ────────────────────────────────────────────

function handleXactTemplates() {
  const kb = getKB()
  if (!kb.scope_templates) {
    return { handled: true, response: 'Xactimate KB not loaded. Check workspace/xactimate-kb/scope-templates.json' }
  }

  const templates = kb.scope_templates.templates || {}
  const keys = Object.keys(templates)

  if (keys.length === 0) {
    return { handled: true, response: 'No scope templates defined.' }
  }

  const lines = [`*Scope Templates* (${keys.length})`, '']
  for (const key of keys) {
    const t = templates[key]
    lines.push(`*${key}* — ${t.name}`)
    lines.push(`  ${t.description}`)
    lines.push(`  Drying: ${t.standardDryingDays} days | Items: ${t.typicalItems.length}`)
    lines.push(`  Equipment: ${t.equipmentRatio}`)
    lines.push('')
  }

  lines.push('Usage: /scope FD-002 template cat3-class2')

  return { handled: true, response: lines.join('\n') }
}

// ── Main Scope Command ──────────────────────────────────────────────

async function handleScope(query, gateway, adapter, chatId, sessionKey) {
  // Parse template from query: "/scope FD-002 template cat3-class2"
  let templateKey = null
  let jobQuery = query

  const templateMatch = query.match(/^(.+?)\s+template\s+(\S+)$/i)
  if (templateMatch) {
    jobQuery = templateMatch[1].trim()
    templateKey = templateMatch[2].trim().toLowerCase()
  }

  // Look up the job
  const job = findJobByIdOrName(jobQuery)
  if (!job) {
    return {
      handled: true,
      response: `Job not found: "${jobQuery}"\n\nTry /scope list to see available jobs, or use a job ID like /scope FD-002`
    }
  }

  // Check for Drive folder
  if (!job.driveFolderId) {
    return {
      handled: true,
      response: `${job.id} (${job.client}) has no Google Drive folder linked.\n\nAdd a driveFolderId to this job first.`
    }
  }

  // Validate template key if provided
  if (templateKey) {
    const kb = getKB()
    const templates = kb.scope_templates?.templates || {}
    if (!templates[templateKey]) {
      const available = Object.keys(templates).join(', ')
      return {
        handled: true,
        response: `Unknown template: "${templateKey}"\n\nAvailable: ${available}\n\nUsage: /scope ${job.id} template cat3-class2`
      }
    }
  }

  // Send acknowledgment
  const templateNote = templateKey ? ` (template: ${templateKey})` : ''
  await adapter.sendMessage(chatId,
    `Analyzing scope for *${job.id}* — ${job.client}${templateNote}\n\nDownloading project files from Drive...`
  )

  // Download files
  console.log(`[ScopeAssistant] Starting scope analysis for ${job.id} (${job.client})${templateNote}`)
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
  const analysisPrompt = buildAnalysisPrompt(job, downloadResult, templateKey)

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

function routeXactCommand(text) {
  const trimmed = text.trim()
  const lower = trimmed.toLowerCase()

  if (!lower.startsWith('/xact')) return null

  // Strip "/xact" prefix
  const rest = trimmed.slice(5).trim()
  const restLower = rest.toLowerCase()

  // /xact (no args) — show help
  if (!rest) return xactHelp()

  // /xact search <term>
  if (restLower.startsWith('search ')) {
    const term = rest.slice(7).trim()
    if (!term) return { handled: true, response: 'Usage: /xact search <term>\nExample: /xact search dehu' }
    return handleXactSearch(term)
  }

  // /xact templates
  if (restLower === 'templates') return handleXactTemplates()

  return xactHelp()
}

function scopeHelp() {
  return {
    handled: true,
    response: [
      '*Scope Assistant Commands*',
      '',
      '/scope <job-id> — Analyze project files for Xactimate line items',
      '/scope <client-name> — Search by client name',
      '/scope <job-id> template <key> — Analyze with IICRC template',
      '/scope list — Show jobs with Drive folders linked',
      '',
      '/xact search <term> — Search Xactimate line items',
      '/xact templates — List scope templates',
      '',
      'Examples:',
      '/scope FD-002',
      '/scope Wigenton',
      '/scope FD-002 template cat3-class2',
      '/xact search dehu',
    ].join('\n')
  }
}

function xactHelp() {
  return {
    handled: true,
    response: [
      '*Xactimate KB Commands*',
      '',
      '/xact search <term> — Search line items by code or description',
      '/xact templates — List available scope templates',
      '',
      'Examples:',
      '/xact search dehu',
      '/xact search antimicrobial',
      '/xact templates',
    ].join('\n')
  }
}

// ── Plugin Registration ─────────────────────────────────────────────

export function register(gateway) {
  // Ensure temp directory exists
  if (!fs.existsSync(SCOPE_TEMP_DIR)) {
    fs.mkdirSync(SCOPE_TEMP_DIR, { recursive: true })
  }

  // Pre-load the knowledge base
  const kb = getKB()
  const kbFiles = Object.keys(kb)
  console.log(`[ScopeAssistant] KB loaded: ${kbFiles.length} file(s) (${kbFiles.join(', ')})`)

  // Wrap the command handler to intercept /scope and /xact before default routing
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

    if (lower.startsWith('/xact')) {
      const result = routeXactCommand(text)
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
      '/scope <job-id> template <key> — Analysis with IICRC template',
      '/scope list — Jobs with Drive folders',
      '/xact search <term> — Search Xactimate codes',
      '/xact templates — List scope templates'
    ]
    result.response += '\n' + scopeLines.join('\n')
    return result
  }

  console.log('[ScopeAssistant] Loaded — /scope and /xact commands enabled')
}

// ── Exports for external use ────────────────────────────────────────

export { getRateMultiplier, calculateRateBreakdown, getKB }
