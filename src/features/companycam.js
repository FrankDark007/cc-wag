import fs from 'fs'

/**
 * CompanyCam Timeline Builder
 * Pulls photos from CompanyCam projects via API and builds daily supervisory timelines
 * for Xactimate invoicing — documents which techs worked which days/hours.
 *
 * Commands:
 *   /timeline <job-id-or-name> — Build daily timeline from CompanyCam photos
 *
 * Requires: COMPANYCAM_API_TOKEN in .env
 *
 * CompanyCam API: https://api.companycam.com/v2/
 *   GET /projects?query=name — search projects
 *   GET /projects/{id}/photos — photos with captured_at, creator_name, coordinates
 *   Rate limit: 240 GET/min
 */

import config from '../config.js'

const JOBS_FILE = config.paths.jobsFile
const FRANK_CHAT_ID = '17034981581@s.whatsapp.net'
const CC_BASE = 'https://api.companycam.com/v2'

// Business hours: 7am-6pm. Anything outside = after-hours/overtime
const BUSINESS_START_HOUR = 7
const BUSINESS_END_HOUR = 18

// ── Storage ─────────────────────────────────────────────────────────

function loadJobs() {
  try {
    if (fs.existsSync(JOBS_FILE)) {
      return JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'))
    }
  } catch (err) {
    console.error('[CompanyCam] Failed to load jobs:', err.message)
  }
  return { nextId: 1, jobs: [] }
}

function findJob(data, query) {
  const upper = query.toUpperCase().trim()

  // Try exact ID match: FD-002, fd-002, 002, 2
  for (const j of data.jobs) {
    if (j.id === upper) return j
    const num = parseInt(query, 10)
    if (!isNaN(num) && j.id === `FD-${String(num).padStart(3, '0')}`) return j
  }

  // Try client name search (case-insensitive partial)
  const lower = query.toLowerCase()
  return data.jobs.find(j => j.client && j.client.toLowerCase().includes(lower))
}

// ── CompanyCam API ──────────────────────────────────────────────────

function getApiToken() {
  const token = process.env.COMPANYCAM_API_TOKEN
  if (!token) {
    throw new Error('COMPANYCAM_API_TOKEN not set in .env')
  }
  return token
}

async function ccFetch(endpoint, params = {}) {
  const token = getApiToken()
  const url = new URL(`${CC_BASE}${endpoint}`)
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v)
  }

  const resp = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json'
    }
  })

  if (!resp.ok) {
    const body = await resp.text().catch(() => '')
    throw new Error(`CompanyCam API ${resp.status}: ${body.substring(0, 200)}`)
  }

  return resp.json()
}

/**
 * Search CompanyCam projects by name
 */
async function searchProjects(query) {
  return ccFetch('/projects', { query })
}

/**
 * Get all photos for a project (paginated)
 */
async function getProjectPhotos(projectId) {
  const allPhotos = []
  let page = 1
  const perPage = 100

  while (true) {
    const photos = await ccFetch(`/projects/${projectId}/photos`, {
      per_page: String(perPage),
      page: String(page)
    })

    if (!Array.isArray(photos) || photos.length === 0) break
    allPhotos.push(...photos)

    // If we got fewer than perPage, that's the last page
    if (photos.length < perPage) break
    page++

    // Safety: don't fetch more than 2000 photos
    if (allPhotos.length >= 2000) break
  }

  return allPhotos
}

// ── Timeline Builder ────────────────────────────────────────────────

function formatDate(isoStr) {
  return new Date(isoStr).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  })
}

function formatTime(isoStr) {
  return new Date(isoStr).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  })
}

function isAfterHours(date) {
  const hour = date.getHours()
  return hour < BUSINESS_START_HOUR || hour >= BUSINESS_END_HOUR
}

/**
 * Build a daily timeline from photos
 * Groups by date, then by tech (creator_name), calculates hours
 */
function buildTimeline(photos) {
  if (!photos || photos.length === 0) {
    return { days: [], totalPhotos: 0, totalDays: 0, techs: new Set() }
  }

  // Parse and sort photos by captured_at
  const parsed = photos
    .map(p => ({
      id: p.id,
      capturedAt: new Date(p.captured_at * 1000), // Unix timestamp
      creator: p.creator?.name || p.creator_name || 'Unknown',
      uri: p.uris?.original_url || p.uris?.photo_url || null,
      lat: p.coordinates?.lat || null,
      lng: p.coordinates?.lon || null,
      tags: (p.tags || []).map(t => t.display_value || t.value || t).filter(Boolean)
    }))
    .filter(p => !isNaN(p.capturedAt.getTime()))
    .sort((a, b) => a.capturedAt - b.capturedAt)

  if (parsed.length === 0) {
    return { days: [], totalPhotos: 0, totalDays: 0, techs: new Set() }
  }

  // Group by date string
  const byDate = new Map()
  const allTechs = new Set()

  for (const photo of parsed) {
    const dateKey = photo.capturedAt.toISOString().split('T')[0]
    if (!byDate.has(dateKey)) byDate.set(dateKey, [])
    byDate.get(dateKey).push(photo)
    allTechs.add(photo.creator)
  }

  // Build daily summaries
  const days = []

  for (const [dateKey, dayPhotos] of byDate) {
    // Group by tech within this day
    const byTech = new Map()
    for (const p of dayPhotos) {
      if (!byTech.has(p.creator)) byTech.set(p.creator, [])
      byTech.get(p.creator).push(p)
    }

    const techSummaries = []
    let dayAfterHoursPhotos = 0

    for (const [tech, techPhotos] of byTech) {
      const first = techPhotos[0].capturedAt
      const last = techPhotos[techPhotos.length - 1].capturedAt
      const spanMs = last - first
      const spanHours = spanMs / (1000 * 60 * 60)

      // Count after-hours photos
      const afterHours = techPhotos.filter(p => isAfterHours(p.capturedAt)).length
      dayAfterHoursPhotos += afterHours

      // Estimate man-hours: time span between first and last photo
      // Minimum 1 hour if only 1 photo, else actual span rounded up to nearest 0.5
      let estimatedHours
      if (techPhotos.length === 1) {
        estimatedHours = 1
      } else {
        estimatedHours = Math.max(1, Math.ceil(spanHours * 2) / 2)
      }

      techSummaries.push({
        tech,
        photoCount: techPhotos.length,
        firstPhoto: first,
        lastPhoto: last,
        estimatedHours,
        afterHoursPhotos: afterHours,
        isAfterHours: afterHours > techPhotos.length / 2
      })
    }

    days.push({
      date: dateKey,
      dateFormatted: formatDate(dateKey),
      totalPhotos: dayPhotos.length,
      techSummaries,
      afterHoursPhotos: dayAfterHoursPhotos
    })
  }

  return {
    days,
    totalPhotos: parsed.length,
    totalDays: days.length,
    techs: allTechs,
    firstDate: parsed[0].capturedAt,
    lastDate: parsed[parsed.length - 1].capturedAt
  }
}

/**
 * Format the timeline into a WhatsApp-friendly message
 */
function formatTimeline(timeline, jobId, clientName, ccProjectName) {
  if (timeline.totalPhotos === 0) {
    return `No photos found in CompanyCam for ${clientName} (${jobId}).`
  }

  const lines = [
    `COMPANYCAM TIMELINE: ${clientName} (${jobId})`,
    `Project: ${ccProjectName}`,
    `${timeline.totalPhotos} photos across ${timeline.totalDays} days`,
    `Techs: ${[...timeline.techs].join(', ')}`,
    `Period: ${formatDate(timeline.firstDate)} - ${formatDate(timeline.lastDate)}`,
    ''
  ]

  // Total man-hours across all days
  let totalManHours = 0
  let totalAfterHours = 0

  for (const day of timeline.days) {
    lines.push(`--- ${day.dateFormatted} (${day.totalPhotos} photos) ---`)

    for (const ts of day.techSummaries) {
      const timeRange = `${formatTime(ts.firstPhoto)} - ${formatTime(ts.lastPhoto)}`
      let line = `  ${ts.tech}: ${timeRange} (~${ts.estimatedHours}h, ${ts.photoCount} photos)`
      if (ts.afterHoursPhotos > 0) {
        line += ` [${ts.afterHoursPhotos} after-hours]`
      }
      lines.push(line)

      totalManHours += ts.estimatedHours
      if (ts.isAfterHours) totalAfterHours += ts.estimatedHours
    }
    lines.push('')
  }

  // Summary
  lines.push('--- SUMMARY ---')
  lines.push(`Total man-hours (estimated): ${totalManHours}`)
  if (totalAfterHours > 0) {
    lines.push(`After-hours work: ~${totalAfterHours}h`)
  }
  lines.push(`Days on site: ${timeline.totalDays}`)

  return lines.join('\n')
}

// ── Command Handler ─────────────────────────────────────────────────

async function handleTimeline(query, gateway, adapter, chatId) {
  if (!query) {
    return {
      handled: true,
      response: [
        'Usage: /timeline <job-id-or-name>',
        'Example: /timeline FD-002',
        'Example: /timeline Wigenton',
        '',
        'Pulls CompanyCam photos and builds a daily supervisory timeline',
        'showing which techs worked which days/hours.'
      ].join('\n')
    }
  }

  // Check API token
  if (!process.env.COMPANYCAM_API_TOKEN) {
    return {
      handled: true,
      response: 'COMPANYCAM_API_TOKEN not configured. Add it to .env to use this feature.'
    }
  }

  // Look up job
  const data = loadJobs()
  const job = findJob(data, query)
  if (!job) {
    return {
      handled: true,
      response: `Job not found: ${query}\nUse /job list to see all jobs.`
    }
  }

  // Send initial "working on it" message
  if (adapter) {
    try {
      await adapter.sendMessage(chatId, `Searching CompanyCam for "${job.client}"...`)
    } catch (e) { /* ignore send errors */ }
  }

  try {
    // Search CompanyCam for the project
    const projects = await searchProjects(job.client)

    if (!Array.isArray(projects) || projects.length === 0) {
      return {
        handled: true,
        response: `No CompanyCam project found matching "${job.client}".\nTry searching by address or a different name.`
      }
    }

    // Use the first match (most relevant)
    const ccProject = projects[0]
    const ccProjectId = ccProject.id
    const ccProjectName = ccProject.name || job.client

    // Fetch all photos
    const photos = await getProjectPhotos(ccProjectId)

    if (photos.length === 0) {
      return {
        handled: true,
        response: `CompanyCam project "${ccProjectName}" found but has no photos.`
      }
    }

    // Build the timeline
    const timeline = buildTimeline(photos)
    const formatted = formatTimeline(timeline, job.id, job.client, ccProjectName)

    // If we have photos and the agent runner is available, send the timeline
    // through the agent for deeper analysis (equipment counting via vision)
    if (timeline.totalPhotos > 0 && gateway.agentRunner) {
      // Build a prompt that includes the timeline data and asks the agent
      // to analyze it. The agent can use Claude vision on photo URLs if needed.
      const samplePhotos = photos
        .slice(0, 5)
        .map(p => {
          const url = p.uris?.original_url || p.uris?.photo_url || null
          const creator = p.creator?.name || p.creator_name || 'Unknown'
          const time = new Date(p.captured_at * 1000).toLocaleString('en-US')
          return url ? `- ${creator} at ${time}: ${url}` : null
        })
        .filter(Boolean)
        .join('\n')

      const agentPrompt = [
        `Here is the CompanyCam supervisory timeline for ${job.client} (${job.id}):`,
        '',
        formatted,
        '',
        'Sample photo URLs (first 5):',
        samplePhotos || '(none available)',
        '',
        'Send this timeline to Frank. Include the full timeline above.',
        'If any photo URLs are accessible, note what equipment is visible (dehumidifiers, air movers, etc).',
        'Highlight any days with after-hours work for overtime billing.',
        'Keep the response organized for WhatsApp reading.'
      ].join('\n')

      // Use enqueueRun so the agent streams the response via WhatsApp
      const sessionKey = `timeline:${job.id}:${Date.now()}`
      gateway.agentRunner.enqueueRun(
        sessionKey,
        agentPrompt,
        adapter,
        chatId
      ).catch(err => {
        console.error('[CompanyCam] Agent analysis failed:', err.message)
      })

      // Return handled with no response since the agent will send it
      return { handled: true, response: null }
    }

    // Fallback: just send the formatted timeline directly
    return { handled: true, response: formatted }

  } catch (err) {
    console.error('[CompanyCam] Timeline error:', err)
    return {
      handled: true,
      response: `CompanyCam error: ${err.message}`
    }
  }
}

// ── Plugin Registration ─────────────────────────────────────────────

export function register(gateway) {
  const originalExecute = gateway.commandHandler.execute.bind(gateway.commandHandler)

  gateway.commandHandler.execute = async function (text, sessionKey, adapter, chatId) {
    const trimmed = text.trim()
    const lower = trimmed.toLowerCase()

    if (lower.startsWith('/timeline')) {
      const query = trimmed.slice(9).trim()
      return handleTimeline(query, gateway, adapter, chatId)
    }

    return originalExecute(text, sessionKey, adapter, chatId)
  }

  // Extend /help
  const originalHelp = gateway.commandHandler.handleHelp.bind(gateway.commandHandler)
  gateway.commandHandler.handleHelp = function () {
    const result = originalHelp()
    const ccLines = [
      '',
      '--- CompanyCam ---',
      '/timeline <job-id-or-name> — photo timeline with tech hours'
    ]
    result.response += '\n' + ccLines.join('\n')
    return result
  }

  const hasToken = !!process.env.COMPANYCAM_API_TOKEN
  console.log(`[CompanyCam] Loaded — /timeline command enabled${hasToken ? '' : ' (NO API TOKEN - set COMPANYCAM_API_TOKEN)'}`)
}
