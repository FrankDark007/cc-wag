import fs from 'fs'
import path from 'path'

/**
 * Monday.com Importer Feature
 * Fetches data from Monday.com GraphQL API and populates jobs.json
 *
 * Commands:
 *   /monday boards          — List all boards
 *   /monday import           — Preview what would be imported/updated
 *   /monday import --confirm — Actually create/update jobs
 *   /monday sync             — Re-sync changed fields from Monday.com
 *   /monday config           — Show current configuration
 *   /monday map              — Show column mapping
 */

import config from '../config.js'

const WORKSPACE = config.paths.workspace
const JOBS_FILE = config.paths.jobsFile
const CONFIG_FILE = path.join(WORKSPACE, 'monday-config.json')
const MONDAY_API = 'https://api.monday.com/v2'

// ── Storage ─────────────────────────────────────────────────────────

function loadJobs() {
  try {
    if (fs.existsSync(JOBS_FILE)) {
      return JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'))
    }
  } catch (err) {
    console.error('[MondayImporter] Failed to load jobs:', err.message)
  }
  return { nextId: 1, jobs: [] }
}

function saveJobs(data) {
  if (!fs.existsSync(WORKSPACE)) fs.mkdirSync(WORKSPACE, { recursive: true })
  fs.writeFileSync(JOBS_FILE, JSON.stringify(data, null, 2))
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'))
    }
  } catch (err) {
    console.error('[MondayImporter] Failed to load config:', err.message)
  }
  return {
    boardId: null,
    columnMapping: {
      address: null, city: null, state: null, email: null, phone: null,
      adjuster: null, adjusterEmail: null, insuranceCompany: null,
      status: null, dateCreated: null, dateCompleted: null
    },
    statusMapping: { Done: 'completed', 'Working on it': 'active', Stuck: 'active' },
    lastSync: null,
    importedCount: 0
  }
}

function saveConfig(config) {
  if (!fs.existsSync(WORKSPACE)) fs.mkdirSync(WORKSPACE, { recursive: true })
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))
}

// ── Monday.com API ──────────────────────────────────────────────────

function getApiKey() {
  return process.env.MONDAY_API_KEY || null
}

function getBoardId() {
  const config = loadConfig()
  return process.env.MONDAY_BOARD_ID || config.boardId || null
}

async function mondayQuery(query, variables = {}) {
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('MONDAY_API_KEY not configured')

  const res = await fetch(MONDAY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': apiKey
    },
    body: JSON.stringify({ query, variables })
  })

  if (res.status === 429) {
    // Rate limited — wait and retry once
    await new Promise(r => setTimeout(r, 2000))
    const retry = await fetch(MONDAY_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiKey
      },
      body: JSON.stringify({ query, variables })
    })
    if (!retry.ok) throw new Error(`Monday.com API error: ${retry.status} ${retry.statusText}`)
    return retry.json()
  }

  if (!res.ok) throw new Error(`Monday.com API error: ${res.status} ${res.statusText}`)
  const data = await res.json()
  if (data.errors && data.errors.length > 0) {
    throw new Error(`Monday.com GraphQL error: ${data.errors[0].message}`)
  }
  return data
}

// ── Helpers ──────────────────────────────────────────────────────────

function makeId(num) {
  return `FD-${String(num).padStart(3, '0')}`
}

function normalizeName(name) {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function findJobByClient(jobs, clientName) {
  const normalized = normalizeName(clientName)
  return jobs.find(j => normalizeName(j.client) === normalized)
}

function findJobByMondayId(jobs, mondayItemId) {
  return jobs.find(j => j.mondayItemId === mondayItemId)
}

function autoMapColumns(columns) {
  const mapping = {}
  const patterns = {
    address: /address/i,
    city: /city/i,
    state: /state/i,
    email: /email/i,
    phone: /phone/i,
    adjuster: /adjuster/i,
    adjusterEmail: /adjuster.*email/i,
    insuranceCompany: /insurance/i,
    status: /status/i,
    dateCreated: /date.*created|created.*date|start.*date/i,
    dateCompleted: /date.*completed|completed.*date|end.*date|completion/i
  }

  for (const col of columns) {
    // Check adjusterEmail before adjuster (more specific first)
    if (patterns.adjusterEmail.test(col.title)) {
      mapping.adjusterEmail = col.id
      continue
    }
    for (const [field, pattern] of Object.entries(patterns)) {
      if (field === 'adjusterEmail') continue // already handled
      if (!mapping[field] && pattern.test(col.title)) {
        mapping[field] = col.id
      }
    }
  }
  return mapping
}

function getColumnValue(item, columnId) {
  if (!columnId) return null
  const col = item.column_values.find(c => c.id === columnId)
  if (!col) return null
  // Prefer text representation, fall back to parsing value JSON
  if (col.text && col.text.trim()) return col.text.trim()
  if (col.value) {
    try {
      const parsed = JSON.parse(col.value)
      // Date columns store { date: "2026-01-15" }
      if (parsed && parsed.date) return parsed.date
      // Status columns store { label: "Done" }
      if (parsed && parsed.label) return parsed.label
      // Email columns store { email: "...", text: "..." }
      if (parsed && parsed.email) return parsed.email
      // Phone columns store { phone: "...", countryShortName: "..." }
      if (parsed && parsed.phone) return parsed.phone
    } catch {}
  }
  return null
}

function mapMondayItemToJobFields(item, columnMapping, statusMapping) {
  const fields = {}

  // Client name is always the item name in Monday.com
  fields.client = item.name.trim()

  if (columnMapping.address) {
    fields.address = getColumnValue(item, columnMapping.address) || ''
  }
  if (columnMapping.city) {
    fields.city = getColumnValue(item, columnMapping.city) || ''
  }
  if (columnMapping.adjuster) {
    fields.adjuster = getColumnValue(item, columnMapping.adjuster) || null
  }
  if (columnMapping.adjusterEmail) {
    fields.adjusterEmail = getColumnValue(item, columnMapping.adjusterEmail) || null
  }
  if (columnMapping.insuranceCompany) {
    fields.insuranceCompany = getColumnValue(item, columnMapping.insuranceCompany) || null
  }
  if (columnMapping.email) {
    fields.email = getColumnValue(item, columnMapping.email) || null
  }
  if (columnMapping.phone) {
    fields.phone = getColumnValue(item, columnMapping.phone) || null
  }

  // Status mapping
  if (columnMapping.status) {
    const rawStatus = getColumnValue(item, columnMapping.status)
    if (rawStatus && statusMapping[rawStatus]) {
      fields.status = statusMapping[rawStatus]
    }
  }

  // Dates
  if (columnMapping.dateCreated) {
    const val = getColumnValue(item, columnMapping.dateCreated)
    if (val) fields.dateCreated = new Date(val).toISOString()
  }
  if (columnMapping.dateCompleted) {
    const val = getColumnValue(item, columnMapping.dateCompleted)
    if (val) fields.dateCompleted = new Date(val).toISOString()
  }

  return fields
}

// ── Fetch all items with pagination ─────────────────────────────────

async function fetchAllBoardItems(boardId) {
  const config = loadConfig()
  let allItems = []
  let columns = []
  let cursor = null
  let isFirst = true

  while (true) {
    let query
    if (isFirst) {
      query = `{ boards(ids: [${boardId}]) { columns { id title type } items_page(limit: 500) { cursor items { id name column_values { id text value } } } } }`
    } else {
      query = `{ next_items_page(limit: 500, cursor: "${cursor}") { cursor items { id name column_values { id text value } } } }`
    }

    const data = await mondayQuery(query)

    if (isFirst) {
      const board = data.data.boards[0]
      if (!board) throw new Error('Board not found')
      columns = board.columns
      const page = board.items_page
      allItems.push(...page.items)
      cursor = page.cursor
      isFirst = false
    } else {
      const page = data.data.next_items_page
      allItems.push(...page.items)
      cursor = page.cursor
    }

    if (!cursor) break
  }

  return { columns, items: allItems }
}

// ── Command Handlers ────────────────────────────────────────────────

async function handleBoards() {
  if (!getApiKey()) {
    return 'Monday.com API key not configured. Add MONDAY_API_KEY to .env'
  }

  try {
    const data = await mondayQuery('{ boards(limit: 50) { id name } }')
    const boards = data.data.boards

    if (!boards || boards.length === 0) {
      return 'No boards found in your Monday.com account.'
    }

    const lines = ['*Monday.com Boards*', '']
    for (const b of boards) {
      lines.push(`${b.id} | ${b.name}`)
    }
    lines.push('')
    lines.push('Set MONDAY_BOARD_ID in .env to the board ID you want to import from.')
    return lines.join('\n')
  } catch (err) {
    return `Error listing boards: ${err.message}`
  }
}

async function handleImport(confirm) {
  if (!getApiKey()) {
    return 'Monday.com API key not configured. Add MONDAY_API_KEY to .env'
  }

  const boardId = getBoardId()
  if (!boardId) {
    return 'No board configured. Run /monday boards to see available boards, then set MONDAY_BOARD_ID in .env'
  }

  try {
    const config = loadConfig()
    const { columns, items } = await fetchAllBoardItems(boardId)

    // Auto-discover column mapping if not set
    let mapping = config.columnMapping
    const hasAnyMapping = Object.values(mapping).some(v => v !== null)
    if (!hasAnyMapping) {
      mapping = { ...config.columnMapping, ...autoMapColumns(columns) }
      config.columnMapping = mapping
      saveConfig(config)
    }

    const jobsData = loadJobs()
    const toCreate = []
    const toUpdate = []

    for (const item of items) {
      // Try to match by mondayItemId first, then by client name
      const existingById = findJobByMondayId(jobsData.jobs, item.id)
      const existingByName = findJobByClient(jobsData.jobs, item.name)
      const existing = existingById || existingByName

      const fields = mapMondayItemToJobFields(item, mapping, config.statusMapping)

      if (existing) {
        // Collect fields that would be updated (only empty fields)
        const updates = {}
        for (const [key, val] of Object.entries(fields)) {
          if (key === 'client') continue // don't update name
          if (val != null && val !== '' && (existing[key] == null || existing[key] === '')) {
            updates[key] = val
          }
        }
        if (Object.keys(updates).length > 0 || !existing.mondayItemId) {
          toUpdate.push({ job: existing, updates, mondayItemId: item.id })
        }
      } else {
        toCreate.push({ item, fields, mondayItemId: item.id })
      }
    }

    if (!confirm) {
      // Preview mode
      const lines = [
        `*Monday.com Import Preview*`,
        `Board: ${boardId} | Items: ${items.length}`,
        ''
      ]

      // Show mapped columns
      const mapped = Object.entries(mapping).filter(([, v]) => v !== null)
      if (mapped.length > 0) {
        lines.push(`Mapped columns: ${mapped.map(([f, id]) => f).join(', ')}`)
        lines.push('')
      }

      lines.push(`Will create: ${toCreate.length} new jobs`)
      lines.push(`Will update: ${toUpdate.length} existing jobs`)
      lines.push(`Unchanged: ${items.length - toCreate.length - toUpdate.length}`)

      if (toCreate.length > 0) {
        lines.push('')
        lines.push('*New jobs (first 10):*')
        for (const entry of toCreate.slice(0, 10)) {
          lines.push(`  + ${entry.fields.client}${entry.fields.city ? ' (' + entry.fields.city + ')' : ''}`)
        }
        if (toCreate.length > 10) lines.push(`  ... +${toCreate.length - 10} more`)
      }

      if (toUpdate.length > 0) {
        lines.push('')
        lines.push('*Updates (first 10):*')
        for (const entry of toUpdate.slice(0, 10)) {
          const fieldNames = Object.keys(entry.updates)
          const desc = fieldNames.length > 0 ? fieldNames.join(', ') : 'link mondayItemId'
          lines.push(`  ~ ${entry.job.id} ${entry.job.client}: ${desc}`)
        }
        if (toUpdate.length > 10) lines.push(`  ... +${toUpdate.length - 10} more`)
      }

      lines.push('')
      lines.push('Run /monday import --confirm to apply.')
      return lines.join('\n')
    }

    // Confirm mode — actually write changes
    let created = 0
    let updated = 0

    for (const entry of toCreate) {
      const now = new Date().toISOString()
      const job = {
        id: makeId(jobsData.nextId),
        client: entry.fields.client,
        address: entry.fields.address || '',
        city: entry.fields.city || '',
        status: entry.fields.status || 'active',
        dateCreated: entry.fields.dateCreated || now,
        dateCompleted: entry.fields.dateCompleted || null,
        invoiceAmount: null,
        invoiceDate: null,
        paymentDate: null,
        adjuster: entry.fields.adjuster || null,
        adjusterEmail: entry.fields.adjusterEmail || null,
        lienDeadline: null,
        mondayItemId: entry.mondayItemId,
        notes: [`Imported from Monday.com item ${entry.mondayItemId}`]
      }

      // Calculate lien deadline from dateCreated
      const created_date = new Date(job.dateCreated)
      created_date.setDate(created_date.getDate() + 90)
      job.lienDeadline = created_date.toISOString()

      // Add optional fields from Monday
      if (entry.fields.email) job.email = entry.fields.email
      if (entry.fields.phone) job.phone = entry.fields.phone
      if (entry.fields.insuranceCompany) job.insuranceCompany = entry.fields.insuranceCompany

      jobsData.jobs.push(job)
      jobsData.nextId++
      created++
    }

    for (const entry of toUpdate) {
      for (const [key, val] of Object.entries(entry.updates)) {
        entry.job[key] = val
      }
      if (!entry.job.mondayItemId) {
        entry.job.mondayItemId = entry.mondayItemId
      }
      updated++
    }

    saveJobs(jobsData)

    config.lastSync = new Date().toISOString()
    config.importedCount += created
    saveConfig(config)

    const lines = [
      '*Monday.com Import Complete*',
      '',
      `Created: ${created} new jobs`,
      `Updated: ${updated} existing jobs`,
      `Total jobs: ${jobsData.jobs.length}`,
      '',
      `Last sync: ${new Date().toLocaleString()}`
    ]
    return lines.join('\n')
  } catch (err) {
    return `Error importing from Monday.com: ${err.message}`
  }
}

async function handleSync() {
  if (!getApiKey()) {
    return 'Monday.com API key not configured. Add MONDAY_API_KEY to .env'
  }

  const boardId = getBoardId()
  if (!boardId) {
    return 'No board configured. Run /monday boards to see available boards, then set MONDAY_BOARD_ID in .env'
  }

  try {
    const config = loadConfig()
    const { columns, items } = await fetchAllBoardItems(boardId)
    const jobsData = loadJobs()

    let updatedCount = 0
    const changes = []

    for (const item of items) {
      const existingById = findJobByMondayId(jobsData.jobs, item.id)
      const existingByName = findJobByClient(jobsData.jobs, item.name)
      const job = existingById || existingByName

      if (!job) continue // skip items not in jobs.json

      const fields = mapMondayItemToJobFields(item, config.columnMapping, config.statusMapping)
      const jobChanges = []

      for (const [key, val] of Object.entries(fields)) {
        if (key === 'client') continue
        if (val == null || val === '') continue

        // Update if: field is empty in jobs.json OR value changed in Monday
        const currentVal = job[key]
        if (currentVal == null || currentVal === '' || currentVal !== val) {
          // Don't overwrite non-empty local values unless Monday value differs
          if (currentVal != null && currentVal !== '' && currentVal === val) continue
          job[key] = val
          jobChanges.push(key)
        }
      }

      // Ensure mondayItemId is linked
      if (!job.mondayItemId) {
        job.mondayItemId = item.id
        jobChanges.push('mondayItemId')
      }

      if (jobChanges.length > 0) {
        updatedCount++
        changes.push(`${job.id} ${job.client}: ${jobChanges.join(', ')}`)
      }
    }

    saveJobs(jobsData)

    config.lastSync = new Date().toISOString()
    saveConfig(config)

    const lines = [`*Monday.com Sync Complete*`, '']
    lines.push(`Updated ${updatedCount} jobs with new data from Monday.com`)

    if (changes.length > 0) {
      lines.push('')
      lines.push('*Changes:*')
      for (const c of changes.slice(0, 15)) {
        lines.push(`  ${c}`)
      }
      if (changes.length > 15) lines.push(`  ... +${changes.length - 15} more`)
    }

    lines.push('')
    lines.push(`Last sync: ${new Date().toLocaleString()}`)
    return lines.join('\n')
  } catch (err) {
    return `Error syncing from Monday.com: ${err.message}`
  }
}

function handleConfig() {
  const config = loadConfig()
  const boardId = getBoardId()

  const lines = ['*Monday.com Configuration*', '']
  lines.push(`API Key: ${getApiKey() ? 'configured' : 'NOT SET (add MONDAY_API_KEY to .env)'}`)
  lines.push(`Board ID: ${boardId || 'NOT SET (add MONDAY_BOARD_ID to .env)'}`)
  lines.push(`Last sync: ${config.lastSync ? new Date(config.lastSync).toLocaleString() : 'never'}`)
  lines.push(`Total imported: ${config.importedCount}`)

  lines.push('')
  lines.push('*Status Mapping:*')
  for (const [monday, local] of Object.entries(config.statusMapping)) {
    lines.push(`  ${monday} -> ${local}`)
  }

  return lines.join('\n')
}

function handleMap() {
  const config = loadConfig()

  const lines = ['*Monday.com Column Mapping*', '']

  const hasAny = Object.values(config.columnMapping).some(v => v !== null)
  if (!hasAny) {
    lines.push('No columns mapped yet.')
    lines.push('Run /monday import to auto-discover column mappings from your board.')
    return lines.join('\n')
  }

  for (const [field, colId] of Object.entries(config.columnMapping)) {
    const status = colId ? `${colId}` : '(not mapped)'
    lines.push(`  ${field}: ${status}`)
  }

  lines.push('')
  lines.push('Mappings are auto-discovered from column titles.')
  lines.push('Edit workspace/monday-config.json to adjust manually.')
  return lines.join('\n')
}

function mondayHelp() {
  return [
    '*Monday.com Importer*',
    '',
    '/monday boards — list available boards',
    '/monday import — preview import from Monday.com',
    '/monday import --confirm — import/update jobs',
    '/monday sync — re-sync changed fields',
    '/monday config — show configuration',
    '/monday map — show column mapping',
  ].join('\n')
}

// ── Main Router ─────────────────────────────────────────────────────

async function routeMondayCommand(text) {
  const trimmed = text.trim()
  const rest = trimmed.slice(7).trim() // strip "/monday"
  const lower = rest.toLowerCase()

  if (!rest || lower === 'help') return mondayHelp()
  if (lower === 'boards') return handleBoards()
  if (lower === 'import') return handleImport(false)
  if (lower === 'import --confirm') return handleImport(true)
  if (lower === 'sync') return handleSync()
  if (lower === 'config') return handleConfig()
  if (lower === 'map') return handleMap()

  return mondayHelp()
}

// ── Plugin Registration ─────────────────────────────────────────────

export function register(gateway) {
  const originalExecute = gateway.commandHandler.execute.bind(gateway.commandHandler)

  gateway.commandHandler.execute = async function (text, sessionKey, adapter, chatId) {
    const lower = text.trim().toLowerCase()

    if (lower.startsWith('/monday')) {
      const response = await routeMondayCommand(text)
      return { handled: true, response }
    }

    return originalExecute(text, sessionKey, adapter, chatId)
  }

  // Extend /help
  const originalHelp = gateway.commandHandler.handleHelp.bind(gateway.commandHandler)
  gateway.commandHandler.handleHelp = function () {
    const result = originalHelp()
    const mondayLines = [
      '',
      '--- Monday.com ---',
      '/monday boards — list boards',
      '/monday import — preview/import from Monday.com',
      '/monday sync — re-sync changed fields',
      '/monday config — show config',
      '/monday map — show column mapping'
    ]
    result.response += '\n' + mondayLines.join('\n')
    return result
  }

  console.log('[MondayImporter] Loaded — /monday commands enabled')
}
