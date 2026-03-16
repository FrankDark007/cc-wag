import fs from 'fs'
import path from 'path'

/**
 * Equipment Tracker Feature
 * Tracks restoration equipment inventory, deployments, and rental days
 *
 * Commands:
 *   /equip list                       — All equipment grouped by status
 *   /equip deploy EQ-XXX FD-XXX      — Deploy equipment to a job
 *   /equip return EQ-XXX             — Return equipment from a job
 *   /equip job FD-XXX                — Equipment on a specific job
 *   /equip add <type> "<name>"       — Register new equipment
 *   /equip remove EQ-XXX             — Retire equipment
 *   /equip alerts                    — Show warnings
 *   /equip maintenance EQ-XXX "reason" — Mark for maintenance
 *   /equip fixed EQ-XXX              — Return to available after maintenance
 *   /equip summary                   — Quick stats
 *   /equip help                      — Show all commands
 *
 * Storage: workspace/equipment.json
 */

import config from '../config.js'

const WORKSPACE = config.paths.workspace
const EQUIP_FILE = path.join(WORKSPACE, 'equipment.json')
const FRANK_CHAT_ID = '17034981581@s.whatsapp.net'

// Equipment types mapped to Xactimate codes
const TYPE_MAP = {
  dehu: 'WTRDHU',
  fan: 'WTRFAN',
  airmover: 'WTRFAN',
  scrubber: 'WTRAHR',
  hepa: 'WTRAHR',
  heater: 'WTRHTR',
  meter: 'WTRMON'
}

const TYPE_LABELS = {
  WTRDHU: 'Dehumidifier',
  WTRFAN: 'Air Mover/Fan',
  WTRAHR: 'Air Scrubber',
  WTRHTR: 'Heater',
  WTRMON: 'Moisture Meter'
}

const MS_PER_DAY = 86400000

// Alert thresholds
const WARN_DAYS = 14
const CRITICAL_DAYS = 21

// ── Job Data Import (with fallback) ─────────────────────────────────

let findJob = null
try {
  const jobData = await import('../utils/job-data.js')
  findJob = jobData.findJob
} catch {
  console.warn('[EquipmentTracker] Could not import job-data.js, job validation disabled')
}

// ── Storage ─────────────────────────────────────────────────────────

function loadEquipment() {
  try {
    if (fs.existsSync(EQUIP_FILE)) {
      return JSON.parse(fs.readFileSync(EQUIP_FILE, 'utf-8'))
    }
  } catch (err) {
    console.error('[EquipmentTracker] Failed to load equipment:', err.message)
  }
  return { nextId: 1, equipment: [] }
}

function saveEquipment(data) {
  const dir = path.dirname(EQUIP_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(EQUIP_FILE, JSON.stringify(data, null, 2))
}

function nextEquipId(data) {
  const id = `EQ-${String(data.nextId).padStart(3, '0')}`
  data.nextId++
  return id
}

function findEquip(data, id) {
  const upper = id.toUpperCase()
  return data.equipment.find(e => e.id === upper) || null
}

function addHistory(equip, action, notes) {
  equip.history.push({
    action,
    date: new Date().toISOString(),
    notes: notes || null
  })
}

function daysSince(isoString) {
  if (!isoString) return 0
  return Math.floor((Date.now() - new Date(isoString).getTime()) / MS_PER_DAY)
}

function getJobLabel(jobId) {
  if (!findJob) return jobId
  const job = findJob(jobId)
  if (!job) return jobId
  const name = job.client || job.clientName || ''
  return name ? `${jobId} - ${name}` : jobId
}

// ── Command Handlers ────────────────────────────────────────────────

function handleList() {
  const data = loadEquipment()
  if (!data.equipment.length) {
    return 'No equipment registered. Use `/equip add <type> "name"` to add.'
  }

  const deployed = data.equipment.filter(e => e.status === 'deployed')
  const available = data.equipment.filter(e => e.status === 'available')
  const maintenance = data.equipment.filter(e => e.status === 'maintenance')
  const retired = data.equipment.filter(e => e.status === 'retired')

  const lines = ['\uD83D\uDD27 *Equipment Inventory*', '\u2501'.repeat(20)]

  if (deployed.length) {
    lines.push(`\n*Deployed* (${deployed.length} units)`)
    for (const e of deployed) {
      const days = daysSince(e.deployedDate)
      const warn = days >= CRITICAL_DAYS ? ' \u203C\uFE0F' : days >= WARN_DAYS ? ' \u26A0\uFE0F' : ''
      const jobLabel = getJobLabel(e.currentJobId)
      lines.push(`\u2022 ${e.id} ${e.name} (${e.type}) \u2192 ${jobLabel} (${days} days)${warn}`)
    }
  }

  if (available.length) {
    lines.push(`\n*Available* (${available.length} units)`)
    for (const e of available) {
      lines.push(`\u2022 ${e.id} ${e.name} (${e.type})`)
    }
  }

  if (maintenance.length) {
    lines.push(`\n*Maintenance* (${maintenance.length} units)`)
    for (const e of maintenance) {
      const reason = e.maintenanceDue || 'unspecified'
      lines.push(`\u2022 ${e.id} ${e.name} \u2014 ${reason}`)
    }
  }

  if (retired.length) {
    lines.push(`\n*Retired* (${retired.length} units)`)
    for (const e of retired) {
      lines.push(`\u2022 ${e.id} ${e.name}`)
    }
  }

  return lines.join('\n')
}

function handleDeploy(args) {
  const parts = args.trim().split(/\s+/)
  if (parts.length < 2) return '\u274C Usage: `/equip deploy EQ-XXX FD-XXX`'

  const equipId = parts[0].toUpperCase()
  const jobId = parts[1].toUpperCase()
  const data = loadEquipment()

  const equip = findEquip(data, equipId)
  if (!equip) return `\u274C Equipment ${equipId} not found`
  if (equip.status !== 'available') return `\u274C ${equipId} is currently ${equip.status}, not available`

  // Validate job exists if we have job-data access
  if (findJob) {
    const job = findJob(jobId)
    if (!job) return `\u274C Job ${jobId} not found`
  }

  equip.status = 'deployed'
  equip.currentJobId = jobId
  equip.deployedDate = new Date().toISOString()
  addHistory(equip, 'deployed', `Deployed to ${jobId}`)
  saveEquipment(data)

  const jobLabel = getJobLabel(jobId)
  return `\u2705 ${equipId} (${equip.name}) deployed to ${jobLabel}`
}

function handleReturn(args) {
  const equipId = args.trim().split(/\s+/)[0]?.toUpperCase()
  if (!equipId) return '\u274C Usage: `/equip return EQ-XXX`'

  const data = loadEquipment()
  const equip = findEquip(data, equipId)
  if (!equip) return `\u274C Equipment ${equipId} not found`
  if (equip.status !== 'deployed') return `\u274C ${equipId} is not deployed (status: ${equip.status})`

  const days = daysSince(equip.deployedDate)
  const jobId = equip.currentJobId
  const jobLabel = getJobLabel(jobId)

  equip.status = 'available'
  equip.currentJobId = null
  equip.deployedDate = null
  addHistory(equip, 'returned', `Returned from ${jobId} (${days} days deployed)`)
  saveEquipment(data)

  return `\u2705 ${equipId} returned from ${jobLabel} (${days} days deployed)`
}

function handleJob(args) {
  const jobId = args.trim().split(/\s+/)[0]?.toUpperCase()
  if (!jobId) return '\u274C Usage: `/equip job FD-XXX`'

  const data = loadEquipment()
  const onJob = data.equipment.filter(e => e.status === 'deployed' && e.currentJobId === jobId)

  if (!onJob.length) return `No equipment deployed to ${jobId}`

  const jobLabel = getJobLabel(jobId)
  const lines = [`\uD83D\uDD27 *Equipment on ${jobLabel}*`, '\u2501'.repeat(25)]

  let totalDays = 0
  const xactCounts = {}

  for (const e of onJob) {
    const days = daysSince(e.deployedDate)
    totalDays += days
    lines.push(`\u2022 ${e.id} ${e.name} (${e.type}) \u2014 ${days} days`)

    const code = e.xactimateCode || TYPE_MAP[e.type] || 'UNKNOWN'
    xactCounts[code] = (xactCounts[code] || 0) + days
  }

  lines.push(`\nTotal: ${onJob.length} units, ${totalDays} equipment-days`)

  const xactParts = Object.entries(xactCounts)
    .map(([code, days]) => `${days} \u00D7 ${code}`)
    .join(', ')
  lines.push(`Xactimate: ${xactParts}`)

  return lines.join('\n')
}

function handleAdd(args) {
  // Parse: <type> "<name>"  or  <type> <name words>
  const match = args.match(/^(\S+)\s+"([^"]+)"/) || args.match(/^(\S+)\s+(.+)/)
  if (!match) return '\u274C Usage: `/equip add <type> "<name>"`\nTypes: dehu, fan, airmover, scrubber, hepa, heater, meter'

  const typeKey = match[1].toLowerCase()
  const name = match[2].trim()
  const xactCode = TYPE_MAP[typeKey]

  if (!xactCode) {
    const validTypes = Object.keys(TYPE_MAP).join(', ')
    return `\u274C Unknown type "${typeKey}". Valid: ${validTypes}`
  }

  const data = loadEquipment()
  const id = nextEquipId(data)

  const equip = {
    id,
    type: typeKey === 'airmover' ? 'fan' : typeKey === 'hepa' ? 'scrubber' : typeKey,
    name,
    serialNumber: null,
    status: 'available',
    currentJobId: null,
    deployedDate: null,
    history: [{ action: 'added', date: new Date().toISOString(), notes: 'Registered in system' }],
    maintenanceDue: null,
    rentalCapDays: null,
    xactimateCode: xactCode
  }

  data.equipment.push(equip)
  saveEquipment(data)

  return `\u2705 Added ${id} ${name} (${equip.type}) \u2014 ${xactCode}`
}

function handleRemove(args) {
  const equipId = args.trim().split(/\s+/)[0]?.toUpperCase()
  if (!equipId) return '\u274C Usage: `/equip remove EQ-XXX`'

  const data = loadEquipment()
  const equip = findEquip(data, equipId)
  if (!equip) return `\u274C Equipment ${equipId} not found`
  if (equip.status === 'deployed') return `\u274C ${equipId} is currently deployed. Return it first.`

  equip.status = 'retired'
  addHistory(equip, 'retired', 'Removed from inventory')
  saveEquipment(data)

  return `\u2705 ${equipId} (${equip.name}) retired from inventory`
}

function handleAlerts() {
  const data = loadEquipment()
  const warnings = buildAlertList(data)

  if (!warnings.length) return '\u2705 No equipment alerts'

  const lines = ['\u26A0\uFE0F *Equipment Alerts*', '\u2501'.repeat(20)]
  lines.push(...warnings)
  return lines.join('\n')
}

function buildAlertList(data) {
  const warnings = []

  for (const e of data.equipment) {
    if (e.status === 'deployed') {
      const days = daysSince(e.deployedDate)
      const jobLabel = getJobLabel(e.currentJobId)

      if (e.rentalCapDays && days >= e.rentalCapDays - 2) {
        warnings.push(`\u203C\uFE0F ${e.id} ${e.name} \u2192 ${jobLabel}: ${days}/${e.rentalCapDays} days (rental cap!)`)
      } else if (days >= CRITICAL_DAYS) {
        warnings.push(`\u203C\uFE0F ${e.id} ${e.name} \u2192 ${jobLabel}: ${days} days deployed (CRITICAL)`)
      } else if (days >= WARN_DAYS) {
        warnings.push(`\u26A0\uFE0F ${e.id} ${e.name} \u2192 ${jobLabel}: ${days} days deployed`)
      }
    }

    if (e.status === 'maintenance') {
      warnings.push(`\uD83D\uDD27 ${e.id} ${e.name}: maintenance \u2014 ${e.maintenanceDue || 'unspecified'}`)
    }
  }

  return warnings
}

function handleMaintenance(args) {
  const match = args.match(/^(\S+)\s+"([^"]+)"/) || args.match(/^(\S+)\s+(.+)/)
  if (!match) return '\u274C Usage: `/equip maintenance EQ-XXX "reason"`'

  const equipId = match[1].toUpperCase()
  const reason = match[2].trim()
  const data = loadEquipment()

  const equip = findEquip(data, equipId)
  if (!equip) return `\u274C Equipment ${equipId} not found`
  if (equip.status === 'deployed') return `\u274C ${equipId} is deployed. Return it first.`

  equip.status = 'maintenance'
  equip.maintenanceDue = reason
  addHistory(equip, 'maintenance', reason)
  saveEquipment(data)

  return `\uD83D\uDD27 ${equipId} (${equip.name}) marked for maintenance: ${reason}`
}

function handleFixed(args) {
  const equipId = args.trim().split(/\s+/)[0]?.toUpperCase()
  if (!equipId) return '\u274C Usage: `/equip fixed EQ-XXX`'

  const data = loadEquipment()
  const equip = findEquip(data, equipId)
  if (!equip) return `\u274C Equipment ${equipId} not found`
  if (equip.status !== 'maintenance') return `\u274C ${equipId} is not in maintenance (status: ${equip.status})`

  equip.status = 'available'
  equip.maintenanceDue = null
  addHistory(equip, 'fixed', 'Returned to available after maintenance')
  saveEquipment(data)

  return `\u2705 ${equipId} (${equip.name}) back in service`
}

function handleSummary() {
  const data = loadEquipment()
  const total = data.equipment.filter(e => e.status !== 'retired').length
  const deployed = data.equipment.filter(e => e.status === 'deployed')
  const available = data.equipment.filter(e => e.status === 'available').length
  const maintenance = data.equipment.filter(e => e.status === 'maintenance').length

  let activeDays = 0
  let warnCount = 0
  for (const e of deployed) {
    const days = daysSince(e.deployedDate)
    activeDays += days
    if (days >= WARN_DAYS) warnCount++
  }

  const lines = [
    `\uD83D\uDD27 Equipment: ${total} total | ${deployed.length} deployed | ${available} available | ${maintenance} maintenance`,
    `\uD83D\uDCB0 Active equipment-days: ${activeDays}`
  ]
  if (warnCount > 0) {
    lines.push(`\u26A0\uFE0F ${warnCount} units deployed >${WARN_DAYS} days`)
  }

  return lines.join('\n')
}

function handleHelp() {
  return [
    '\uD83D\uDD27 *Equipment Tracker Commands*',
    '\u2501'.repeat(25),
    '`/equip list` \u2014 All equipment by status',
    '`/equip deploy EQ-XXX FD-XXX` \u2014 Deploy to job',
    '`/equip return EQ-XXX` \u2014 Return from job',
    '`/equip job FD-XXX` \u2014 Equipment on a job',
    '`/equip add <type> "name"` \u2014 Register new equipment',
    '`/equip remove EQ-XXX` \u2014 Retire equipment',
    '`/equip alerts` \u2014 Show warnings',
    '`/equip maintenance EQ-XXX "reason"` \u2014 Mark for maintenance',
    '`/equip fixed EQ-XXX` \u2014 Back in service',
    '`/equip summary` \u2014 Quick stats',
    '',
    '*Types:* dehu, fan, airmover, scrubber, hepa, heater, meter'
  ].join('\n')
}

// ── Main Command Router ─────────────────────────────────────────────

async function handleEquip(text) {
  // Strip /equip prefix
  const body = text.replace(/^\/equip\s*/i, '').trim()
  const cmd = body.split(/\s+/)[0]?.toLowerCase() || ''
  const args = body.slice(cmd.length).trim()

  switch (cmd) {
    case 'list': return handleList()
    case 'deploy': return handleDeploy(args)
    case 'return': return handleReturn(args)
    case 'job': return handleJob(args)
    case 'add': return handleAdd(args)
    case 'remove': return handleRemove(args)
    case 'alerts': return handleAlerts()
    case 'maintenance': return handleMaintenance(args)
    case 'fixed': return handleFixed(args)
    case 'summary': return handleSummary()
    case 'help': return handleHelp()
    case '': return handleHelp()
    default: return `Unknown subcommand: ${cmd}. Try \`/equip help\``
  }
}

// ── Daily Alert Cron ────────────────────────────────────────────────

function setupAlerts(gateway) {
  let lastAlertDate = null
  const timer = setInterval(() => {
    const now = new Date()
    const today = now.toISOString().slice(0, 10)
    if (now.getHours() === 11 && now.getMinutes() === 5 && lastAlertDate !== today) {
      lastAlertDate = today
      checkAlerts(gateway)
    }
  }, 60000)
  gateway._equipmentAlertTimer = timer
}

function checkAlerts(gateway) {
  const data = loadEquipment()
  const warnings = buildAlertList(data)
  if (!warnings.length) return

  const msg = ['\u26A0\uFE0F *Equipment Alert*', '\u2501'.repeat(20), ...warnings].join('\n')

  const adapter = gateway.adapters.get('whatsapp')
  if (!adapter) {
    console.log('[EquipmentTracker] No WhatsApp adapter for alert')
    return
  }

  adapter.sendMessage(FRANK_CHAT_ID, msg)
    .then(() => console.log('[EquipmentTracker] Sent daily alert'))
    .catch(err => console.error('[EquipmentTracker] Alert send failed:', err.message))
}

// ── Public API (for other features) ─────────────────────────────────

function getEquipmentForJob(jobId) {
  const data = loadEquipment()
  const upper = jobId.toUpperCase()
  return data.equipment.filter(e => e.status === 'deployed' && e.currentJobId === upper)
}

function getEquipmentSummary() {
  const data = loadEquipment()
  const active = data.equipment.filter(e => e.status !== 'retired')
  return {
    total: active.length,
    deployed: active.filter(e => e.status === 'deployed').length,
    available: active.filter(e => e.status === 'available').length,
    maintenance: active.filter(e => e.status === 'maintenance').length
  }
}

function getActiveEquipmentDays() {
  const data = loadEquipment()
  let total = 0
  for (const e of data.equipment) {
    if (e.status === 'deployed' && e.deployedDate) {
      total += daysSince(e.deployedDate)
    }
  }
  return total
}

// ── Register ────────────────────────────────────────────────────────

export function register(gateway) {
  const originalExecute = gateway.commandHandler.execute.bind(gateway.commandHandler)

  gateway.commandHandler.execute = async function (text, sessionKey, adapter, chatId) {
    const cmd = text.trim().toLowerCase()
    if (cmd.startsWith('/equip')) {
      const response = await handleEquip(text.trim())
      return { handled: true, response }
    }
    return originalExecute(text, sessionKey, adapter, chatId)
  }

  // Expose API for other features
  gateway._equipmentTracker = {
    getEquipmentForJob,
    getEquipmentSummary,
    getActiveEquipmentDays
  }

  // Set up daily alert cron
  setupAlerts(gateway)

  console.log('[EquipmentTracker] Feature loaded — /equip commands, daily alerts at 11:05')
}
