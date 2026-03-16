import fs from 'fs'
import path from 'path'
import config from '../config.js'

/**
 * Shared Job Data Utilities
 * Centralizes jobs.json access, formatting, and date helpers
 *
 * Used by: inbox-miner, job-tracker, lien-tracker, revenue-dashboard, etc.
 * Storage: workspace/jobs.json, workspace/disputes.json
 */

const JOBS_FILE = config.paths.jobsFile
const DISPUTES_FILE = config.paths.disputesFile
const MS_PER_DAY = 86400000

// ── Core Job Operations ─────────────────────────────────────────────

/**
 * Load jobs data from disk
 * @returns {{ nextId: number, jobs: Array }}
 */
export function loadJobs() {
  try {
    if (fs.existsSync(JOBS_FILE)) {
      const raw = fs.readFileSync(JOBS_FILE, 'utf-8')
      const data = JSON.parse(raw)
      // Handle both array and object formats
      if (Array.isArray(data)) return { nextId: data.length + 1, jobs: data }
      return data
    }
  } catch (err) {
    console.error('[job-data] Failed to load jobs:', err.message)
  }
  return { nextId: 1, jobs: [] }
}

/**
 * Save jobs data to disk
 * @param {{ nextId: number, jobs: Array }} data
 */
export function saveJobs(data) {
  const dir = path.dirname(JOBS_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(JOBS_FILE, JSON.stringify(data, null, 2))
}

/**
 * Find a job by ID (case-insensitive, accepts "FD-001", "fd-001", "001", "1")
 * @param {string} id
 * @returns {object|null}
 */
export function findJob(id) {
  const data = loadJobs()
  const upper = id.toUpperCase()
  return data.jobs.find(j => {
    if (j.id === upper) return true
    const num = parseInt(id, 10)
    if (!isNaN(num) && j.id === `FD-${String(num).padStart(3, '0')}`) return true
    return false
  }) || null
}

/**
 * Fuzzy match jobs by client name (case-insensitive substring)
 * @param {string} name
 * @returns {Array}
 */
export function findJobByName(name) {
  const data = loadJobs()
  const lower = name.toLowerCase()
  return data.jobs.filter(j => {
    const client = (j.client || j.clientName || '').toLowerCase()
    return client.includes(lower)
  })
}

/**
 * Filter jobs by status
 * @param {string} status
 * @returns {Array}
 */
export function findJobsByStatus(status) {
  const data = loadJobs()
  const lower = status.toLowerCase()
  return data.jobs.filter(j => (j.status || '').toLowerCase() === lower)
}

/**
 * Update a job by ID, merging in new fields
 * @param {string} id
 * @param {object} updates
 * @returns {object|null} updated job or null if not found
 */
export function updateJob(id, updates) {
  const data = loadJobs()
  const upper = id.toUpperCase()
  const job = data.jobs.find(j => {
    if (j.id === upper) return true
    const num = parseInt(id, 10)
    if (!isNaN(num) && j.id === `FD-${String(num).padStart(3, '0')}`) return true
    return false
  })
  if (!job) return null

  Object.assign(job, updates)
  saveJobs(data)
  return job
}

/**
 * Append a note to a job's notes array with timestamp prefix
 * @param {string} id
 * @param {string} note
 * @returns {boolean} success
 */
export function addJobNote(id, note) {
  const data = loadJobs()
  const upper = id.toUpperCase()
  const job = data.jobs.find(j => {
    if (j.id === upper) return true
    const num = parseInt(id, 10)
    if (!isNaN(num) && j.id === `FD-${String(num).padStart(3, '0')}`) return true
    return false
  })
  if (!job) return false

  if (!Array.isArray(job.notes)) job.notes = []
  job.notes.push({
    text: note,
    date: new Date().toISOString()
  })
  saveJobs(data)
  return true
}

// ── Disputes ────────────────────────────────────────────────────────

/**
 * Load disputes data (creates file if missing)
 * @returns {{ disputes: Array }}
 */
export function loadDisputes() {
  try {
    if (fs.existsSync(DISPUTES_FILE)) {
      return JSON.parse(fs.readFileSync(DISPUTES_FILE, 'utf-8'))
    }
  } catch (err) {
    console.error('[job-data] Failed to load disputes:', err.message)
  }
  return { disputes: [] }
}

/**
 * Save disputes data to disk
 * @param {{ disputes: Array }} data
 */
export function saveDisputes(data) {
  const dir = path.dirname(DISPUTES_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(DISPUTES_FILE, JSON.stringify(data, null, 2))
}

// ── Formatting ──────────────────────────────────────────────────────

/**
 * Format cents integer as "$1,234.56"
 * @param {number} cents
 * @returns {string}
 */
export function formatMoney(cents) {
  if (cents == null || isNaN(cents)) return '$0.00'
  const dollars = cents / 100
  return '$' + dollars.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

/**
 * Format dollars float as "$1,234.56"
 * @param {number} dollars
 * @returns {string}
 */
export function formatMoneyDollars(dollars) {
  if (dollars == null || isNaN(dollars)) return '$0.00'
  return '$' + Number(dollars).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

/**
 * Format ISO date string as "Mar 7, 2026"
 * @param {string} isoString
 * @returns {string}
 */
export function formatDate(isoString) {
  if (!isoString) return '\u2014'
  const d = new Date(isoString)
  if (isNaN(d.getTime())) return '\u2014'
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
}

/**
 * Format ISO date string as "3/7/26"
 * @param {string} isoString
 * @returns {string}
 */
export function formatDateShort(isoString) {
  if (!isoString) return '\u2014'
  const d = new Date(isoString)
  if (isNaN(d.getTime())) return '\u2014'
  const m = d.getMonth() + 1
  const day = d.getDate()
  const y = String(d.getFullYear()).slice(-2)
  return `${m}/${day}/${y}`
}

// ── Date Math ───────────────────────────────────────────────────────

/**
 * Days until a future date (positive = future, negative = past)
 * @param {string} isoString
 * @returns {number}
 */
export function daysUntil(isoString) {
  if (!isoString) return Infinity
  const d = new Date(isoString)
  if (isNaN(d.getTime())) return Infinity
  return Math.ceil((d.getTime() - Date.now()) / MS_PER_DAY)
}

/**
 * Days since a past date (positive number)
 * @param {string} isoString
 * @returns {number}
 */
export function daysAgo(isoString) {
  if (!isoString) return Infinity
  const d = new Date(isoString)
  if (isNaN(d.getTime())) return Infinity
  return Math.floor((Date.now() - d.getTime()) / MS_PER_DAY)
}

/**
 * True if date is in the past
 * @param {string} isoString
 * @returns {boolean}
 */
export function isOverdue(isoString) {
  if (!isoString) return false
  const d = new Date(isoString)
  if (isNaN(d.getTime())) return false
  return d.getTime() < Date.now()
}

// ── ID & Date Helpers ───────────────────────────────────────────────

/**
 * Create a job ID string from a number (e.g., 1 → "FD-001")
 * @param {number} num
 * @returns {string}
 */
export function makeJobId(num) {
  return `FD-${String(num).padStart(3, '0')}`
}

/**
 * Add days to a date and return ISO string
 * @param {string|Date} date
 * @param {number} days
 * @returns {string}
 */
export function addDays(date, days) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d.toISOString()
}

/**
 * Find a job in a data object by ID string
 * Used by features that already have the data loaded
 * @param {{ jobs: Array }} data
 * @param {string} idStr
 * @returns {object|null}
 */
export function findJobInData(data, idStr) {
  const upper = idStr.toUpperCase()
  return data.jobs.find(j => {
    if (j.id === upper) return true
    const num = parseInt(idStr, 10)
    if (!isNaN(num) && j.id === `FD-${String(num).padStart(3, '0')}`) return true
    return false
  }) || null
}

// ── Status Helpers ──────────────────────────────────────────────────

const STATUS_EMOJI = {
  'active': '\uD83D\uDD35',        // blue circle
  'completed': '\u2705',            // check mark
  'needs-invoice': '\uD83D\uDCDD', // memo
  'invoiced': '\uD83D\uDCE8',      // envelope with arrow
  'payment-pending': '\u23F3',      // hourglass
  'paid': '\uD83D\uDCB0',          // money bag
  'disputed': '\u26A0\uFE0F',      // warning
  'lien-filed': '\uD83D\uDD34',    // red circle
  'closed': '\u2B1B'               // black square
}

/**
 * Get emoji for a job status
 * @param {string} status
 * @returns {string}
 */
export function statusEmoji(status) {
  return STATUS_EMOJI[(status || '').toLowerCase()] || '\u26AA'
}
