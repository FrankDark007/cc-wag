import fs from 'fs'
import path from 'path'

/**
 * License & Insurance Monitor Feature
 * Tracks expiration dates for business licenses, insurance policies, certifications
 * Alerts 30/14/7 days before expiry
 *
 * Commands:
 *   /license add "GL Insurance" expires 2026-09-01
 *   /licenses               — list all with days remaining
 *   /licenses expiring      — within 30 days
 *
 * Storage: workspace/licenses.json
 * Cron: Weekly Monday 10:30 AM
 */

import config from '../config.js'

const LICENSES_FILE = config.paths.licensesFile
const FRANK_CHAT_ID = '17034981581@s.whatsapp.net'
const MS_PER_DAY = 86400000

// ── Storage ─────────────────────────────────────────────────────────

function loadLicenses() {
  try {
    if (!fs.existsSync(LICENSES_FILE)) return []
    const raw = fs.readFileSync(LICENSES_FILE, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return []
  }
}

function saveLicenses(licenses) {
  const dir = path.dirname(LICENSES_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(LICENSES_FILE, JSON.stringify(licenses, null, 2))
}

// ── Helpers ─────────────────────────────────────────────────────────

function daysUntil(isoStr) {
  if (!isoStr) return Infinity
  const d = new Date(isoStr)
  if (isNaN(d.getTime())) return Infinity
  return Math.ceil((d.getTime() - Date.now()) / MS_PER_DAY)
}

function formatDate(isoStr) {
  if (!isoStr) return '—'
  return new Date(isoStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
  })
}

function statusEmoji(daysLeft) {
  if (daysLeft <= 0) return '⛔'
  if (daysLeft <= 7) return '🚨'
  if (daysLeft <= 14) return '🔴'
  if (daysLeft <= 30) return '🟡'
  if (daysLeft <= 60) return '🟢'
  return '✅'
}

// ── /license add ────────────────────────────────────────────────────

function handleLicenseAdd(argsStr) {
  // Parse: "Name Here" expires 2026-09-01
  // Also accept: Name Here expires 2026-09-01 (without quotes)
  let name = ''
  let expiresDate = ''

  // Try quoted name first
  const quotedMatch = argsStr.match(/^["'](.+?)["']\s+expires?\s+(\d{4}-\d{2}-\d{2})/i)
  if (quotedMatch) {
    name = quotedMatch[1].trim()
    expiresDate = quotedMatch[2]
  } else {
    // Unquoted: everything before "expires" is the name
    const expiresMatch = argsStr.match(/^(.+?)\s+expires?\s+(\d{4}-\d{2}-\d{2})/i)
    if (expiresMatch) {
      name = expiresMatch[1].trim()
      expiresDate = expiresMatch[2]
    }
  }

  if (!name || !expiresDate) {
    return {
      handled: true,
      response: [
        'Usage: /license add "Name" expires YYYY-MM-DD',
        '',
        'Examples:',
        '/license add "GL Insurance" expires 2026-09-01',
        '/license add "IICRC Certification" expires 2026-12-15',
        '/license add VA Contractor License expires 2027-01-01'
      ].join('\n')
    }
  }

  // Validate date
  const d = new Date(expiresDate + 'T00:00:00')
  if (isNaN(d.getTime())) {
    return { handled: true, response: `Invalid date: ${expiresDate}. Use YYYY-MM-DD format.` }
  }

  const licenses = loadLicenses()

  // Check for duplicate
  const existing = licenses.find(l => l.name.toLowerCase() === name.toLowerCase())
  if (existing) {
    // Update existing
    existing.expires = expiresDate
    existing.updatedAt = new Date().toISOString()
    saveLicenses(licenses)

    const daysLeft = daysUntil(expiresDate)
    return {
      handled: true,
      response: [
        `${statusEmoji(daysLeft)} *${name}* — updated`,
        `Expires: ${formatDate(expiresDate)} (${daysLeft} days)`,
      ].join('\n')
    }
  }

  // Add new
  const license = {
    id: `LIC-${String(licenses.length + 1).padStart(3, '0')}`,
    name,
    expires: expiresDate,
    addedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    renewalNotes: null
  }

  licenses.push(license)
  saveLicenses(licenses)

  const daysLeft = daysUntil(expiresDate)

  return {
    handled: true,
    response: [
      `${statusEmoji(daysLeft)} *${name}* — added`,
      `ID: ${license.id}`,
      `Expires: ${formatDate(expiresDate)} (${daysLeft} days)`,
    ].join('\n')
  }
}

// ── /licenses — list all ────────────────────────────────────────────

function handleLicensesList() {
  const licenses = loadLicenses()

  if (licenses.length === 0) {
    return {
      handled: true,
      response: [
        'No licenses tracked yet.',
        '',
        'Add one: /license add "GL Insurance" expires 2026-09-01'
      ].join('\n')
    }
  }

  // Sort by expiration (soonest first)
  const sorted = licenses
    .map(l => ({ ...l, daysLeft: daysUntil(l.expires) }))
    .sort((a, b) => a.daysLeft - b.daysLeft)

  const lines = [
    `📋 *Licenses & Insurance* (${sorted.length} tracked)`,
    ''
  ]

  for (const l of sorted) {
    const emoji = statusEmoji(l.daysLeft)
    let status = `${l.daysLeft} days`
    if (l.daysLeft <= 0) status = 'EXPIRED'

    lines.push(`${emoji} *${l.name}*`)
    lines.push(`   Expires: ${formatDate(l.expires)} (${status})`)
    if (l.renewalNotes) {
      lines.push(`   Note: ${l.renewalNotes}`)
    }
  }

  const expiringSoon = sorted.filter(l => l.daysLeft <= 30 && l.daysLeft > 0)
  const expired = sorted.filter(l => l.daysLeft <= 0)

  if (expired.length > 0) {
    lines.push('')
    lines.push(`⛔ ${expired.length} EXPIRED — renew immediately!`)
  }

  if (expiringSoon.length > 0) {
    lines.push('')
    lines.push(`⚠️ ${expiringSoon.length} expiring within 30 days`)
  }

  return { handled: true, response: lines.join('\n') }
}

// ── /licenses expiring — within 30 days ─────────────────────────────

function handleLicensesExpiring() {
  const licenses = loadLicenses()
  const expiring = licenses
    .map(l => ({ ...l, daysLeft: daysUntil(l.expires) }))
    .filter(l => l.daysLeft <= 30)
    .sort((a, b) => a.daysLeft - b.daysLeft)

  if (expiring.length === 0) {
    return { handled: true, response: '✅ No licenses expiring within 30 days.' }
  }

  const lines = [
    `⚠️ *Expiring Licenses* (${expiring.length} within 30 days)`,
    ''
  ]

  for (const l of expiring) {
    const emoji = statusEmoji(l.daysLeft)
    let status = `${l.daysLeft} days`
    if (l.daysLeft <= 0) status = '⛔ EXPIRED'

    lines.push(`${emoji} *${l.name}*`)
    lines.push(`   Expires: ${formatDate(l.expires)} (${status})`)
    if (l.renewalNotes) {
      lines.push(`   Note: ${l.renewalNotes}`)
    }
    lines.push('')
  }

  lines.push('Renew these ASAP to avoid business interruption.')

  return { handled: true, response: lines.join('\n') }
}

// ── Command Router ──────────────────────────────────────────────────

function routeLicenseCommand(text) {
  const trimmed = text.trim()
  const lower = trimmed.toLowerCase()

  // /licenses commands
  if (lower === '/licenses') return handleLicensesList()
  if (lower === '/licenses expiring') return handleLicensesExpiring()

  // /license add ...
  if (lower.startsWith('/license add ')) {
    const argsStr = trimmed.slice(13).trim()
    return handleLicenseAdd(argsStr)
  }

  // /license (no args) — show help
  if (lower === '/license' || lower === '/licenses help') {
    return {
      handled: true,
      response: [
        '*License Monitor Commands*',
        '',
        '/license add "Name" expires YYYY-MM-DD',
        '/licenses — list all with days remaining',
        '/licenses expiring — within 30 days',
        '',
        'Examples:',
        '/license add "GL Insurance" expires 2026-09-01',
        '/license add "IICRC Cert" expires 2026-12-15',
        '/license add VA Contractor License expires 2027-01-01'
      ].join('\n')
    }
  }

  return null
}

// ── Weekly Cron Alert ───────────────────────────────────────────────

function runWeeklyLicenseCheck(gateway) {
  const licenses = loadLicenses()

  if (licenses.length === 0) {
    console.log('[LicenseMonitor] Weekly check — no licenses tracked')
    return
  }

  const all = licenses
    .map(l => ({ ...l, daysLeft: daysUntil(l.expires) }))
    .sort((a, b) => a.daysLeft - b.daysLeft)

  const expired = all.filter(l => l.daysLeft <= 0)
  const critical = all.filter(l => l.daysLeft > 0 && l.daysLeft <= 7)
  const warning14 = all.filter(l => l.daysLeft > 7 && l.daysLeft <= 14)
  const warning30 = all.filter(l => l.daysLeft > 14 && l.daysLeft <= 30)

  const totalAlerts = expired.length + critical.length + warning14.length + warning30.length

  if (totalAlerts === 0) {
    console.log('[LicenseMonitor] Weekly check — all licenses current')
    return
  }

  const lines = [
    `📋 *Weekly License Check* — ${totalAlerts} item${totalAlerts > 1 ? 's' : ''} need attention`,
    ''
  ]

  if (expired.length > 0) {
    lines.push('⛔ *EXPIRED:*')
    for (const l of expired) {
      lines.push(`  ${l.name} — expired ${formatDate(l.expires)}`)
    }
    lines.push('')
  }

  if (critical.length > 0) {
    lines.push('🚨 *Expiring this week:*')
    for (const l of critical) {
      lines.push(`  ${l.name} — ${l.daysLeft} days (${formatDate(l.expires)})`)
    }
    lines.push('')
  }

  if (warning14.length > 0) {
    lines.push('🔴 *Expiring within 14 days:*')
    for (const l of warning14) {
      lines.push(`  ${l.name} — ${l.daysLeft} days (${formatDate(l.expires)})`)
    }
    lines.push('')
  }

  if (warning30.length > 0) {
    lines.push('🟡 *Expiring within 30 days:*')
    for (const l of warning30) {
      lines.push(`  ${l.name} — ${l.daysLeft} days (${formatDate(l.expires)})`)
    }
    lines.push('')
  }

  lines.push('Reply /licenses for full list')

  const adapter = gateway.adapters.get('whatsapp')
  if (adapter) {
    adapter.sendMessage(FRANK_CHAT_ID, lines.join('\n'))
      .then(() => console.log(`[LicenseMonitor] Sent weekly alert (${totalAlerts} items)`))
      .catch(err => console.error('[LicenseMonitor] Send failed:', err.message))
  }
}

// ── Plugin Registration ─────────────────────────────────────────────

export function register(gateway) {
  // Ensure workspace directory exists
  const dir = path.dirname(LICENSES_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  // Intercept /license and /licenses commands
  const originalExecute = gateway.commandHandler.execute.bind(gateway.commandHandler)

  gateway.commandHandler.execute = async function (text, sessionKey, adapter, chatId) {
    const lower = text.trim().toLowerCase()

    if (lower.startsWith('/license')) {
      const result = routeLicenseCommand(text)
      if (result) return result
    }

    return originalExecute(text, sessionKey, adapter, chatId)
  }

  // Extend /help
  const originalHelp = gateway.commandHandler.handleHelp.bind(gateway.commandHandler)
  gateway.commandHandler.handleHelp = function () {
    const result = originalHelp()
    const licenseLines = [
      '',
      '--- License Monitor ---',
      '/license add "Name" expires YYYY-MM-DD',
      '/licenses — list all tracked',
      '/licenses expiring — within 30 days'
    ]
    result.response += '\n' + licenseLines.join('\n')
    return result
  }

  // Weekly cron: Monday 10:30 AM
  let lastCronWeek = null

  const timer = setInterval(() => {
    const now = new Date()
    const hour = now.getHours()
    const minute = now.getMinutes()
    const day = now.getDay() // 0=Sun, 1=Mon

    // No alerts before 10am (Frank's schedule)
    if (hour < 10) return

    // Monday 10:30 AM
    if (day === 1 && hour === 10 && minute === 30) {
      // Use ISO week number to prevent duplicate runs
      const weekKey = `${now.getFullYear()}-W${Math.ceil((now.getDate() + 6 - now.getDay()) / 7)}`
      if (lastCronWeek === weekKey) return
      lastCronWeek = weekKey

      runWeeklyLicenseCheck(gateway)
    }
  }, 60000) // check every minute

  gateway._licenseMonitorTimer = timer

  console.log('[LicenseMonitor] Loaded — /license, /licenses commands + weekly Monday 10:30 AM check')
}
