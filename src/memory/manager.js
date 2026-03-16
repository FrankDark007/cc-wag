import fs from 'fs'
import path from 'path'
import os from 'os'

const WORKSPACE = '/Users/ghost/Projects/cc-wag/workspace'
const MEMORY_DIR = path.join(WORKSPACE, 'memory')
const OBSERVATIONS_FILE = path.join(MEMORY_DIR, 'observations.jsonl')
const CLAUDE_MD_PATH = path.join(os.homedir(), '.claude', 'CLAUDE.md')

/**
 * Memory Manager for Atlas
 * Handles daily logs and curated long-term memory
 */
export default class MemoryManager {
  constructor() {
    this.workspace = WORKSPACE
    this.memoryDir = MEMORY_DIR
    this.ensureDirectories()

    // Cache for observations (invalidated on write)
    this._observationCache = null
    this._observationCacheMtime = 0

    // Cache for memory context (5-min TTL)
    this._memoryContextCache = null
    this._memoryContextCacheTime = 0
    this._memoryContextTTL = 5 * 60 * 1000 // 5 minutes
  }

  ensureDirectories() {
    if (!fs.existsSync(this.workspace)) {
      fs.mkdirSync(this.workspace, { recursive: true })
    }
    if (!fs.existsSync(this.memoryDir)) {
      fs.mkdirSync(this.memoryDir, { recursive: true })
    }
  }

  /**
   * Get today's date in YYYY-MM-DD format
   */
  getToday() {
    return new Date().toISOString().split('T')[0]
  }

  /**
   * Get yesterday's date in YYYY-MM-DD format
   */
  getYesterday() {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    return d.toISOString().split('T')[0]
  }

  /**
   * Get path to daily memory file
   */
  getDailyPath(date) {
    return path.join(this.memoryDir, `${date}.md`)
  }

  /**
   * Get path to curated memory file
   */
  getMemoryPath() {
    return path.join(this.workspace, 'MEMORY.md')
  }

  /**
   * Read a file safely
   */
  readFile(filepath) {
    try {
      if (fs.existsSync(filepath)) {
        return fs.readFileSync(filepath, 'utf-8')
      }
    } catch (err) {
      console.error(`[Memory] Failed to read ${filepath}:`, err.message)
    }
    return null
  }

  /**
   * Write to a file
   */
  writeFile(filepath, content) {
    try {
      fs.writeFileSync(filepath, content, 'utf-8')
      return true
    } catch (err) {
      console.error(`[Memory] Failed to write ${filepath}:`, err.message)
      return false
    }
  }

  /**
   * Append to a file
   */
  appendFile(filepath, content) {
    try {
      fs.appendFileSync(filepath, content, 'utf-8')
      return true
    } catch (err) {
      console.error(`[Memory] Failed to append to ${filepath}:`, err.message)
      return false
    }
  }

  /**
   * Read today's daily memory
   */
  readTodayMemory() {
    return this.readFile(this.getDailyPath(this.getToday()))
  }

  /**
   * Read yesterday's daily memory
   */
  readYesterdayMemory() {
    return this.readFile(this.getDailyPath(this.getYesterday()))
  }

  /**
   * Read curated long-term memory
   */
  readLongTermMemory() {
    return this.readFile(this.getMemoryPath())
  }

  /**
   * Append to today's daily memory
   */
  appendToDailyMemory(content) {
    const filepath = this.getDailyPath(this.getToday())
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false })
    const entry = `\n## ${timestamp}\n${content}\n`
    return this.appendFile(filepath, entry)
  }

  /**
   * Append to curated long-term memory
   */
  appendToLongTermMemory(content) {
    const filepath = this.getMemoryPath()
    const timestamp = new Date().toISOString().split('T')[0]
    const entry = `\n## ${timestamp}\n${content}\n`
    return this.appendFile(filepath, entry)
  }

  /**
   * Load CLAUDE.md as read-only context
   */
  getClaudeMdContext() {
    try {
      if (fs.existsSync(CLAUDE_MD_PATH)) {
        const content = fs.readFileSync(CLAUDE_MD_PATH, 'utf-8')
        // Truncate if too long (keep first 2000 chars for context window efficiency)
        if (content.length > 4000) {
          return content.substring(0, 4000) + '\n\n... (truncated for context efficiency)'
        }
        return content
      }
    } catch (err) {
      console.error('[Memory] Failed to read CLAUDE.md:', err.message)
    }
    return null
  }

  /**
   * Get all memory context for session start
   */
  getMemoryContext() {
    const now = Date.now()
    if (this._memoryContextCache && (now - this._memoryContextCacheTime) < this._memoryContextTTL) {
      return this._memoryContextCache
    }

    const parts = []

    const longTerm = this.readLongTermMemory()
    if (longTerm) {
      parts.push(`## Long-Term Memory (MEMORY.md)\n${longTerm}`)
    }

    const yesterday = this.readYesterdayMemory()
    if (yesterday) {
      parts.push(`## Yesterday's Notes (${this.getYesterday()})\n${yesterday}`)
    }

    const today = this.readTodayMemory()
    if (today) {
      parts.push(`## Today's Notes (${this.getToday()})\n${today}`)
    }

    this._memoryContextCache = parts.join('\n\n---\n\n')
    this._memoryContextCacheTime = now

    return this._memoryContextCache
  }

  /**
   * List all daily memory files
   */
  listDailyFiles() {
    try {
      return fs.readdirSync(this.memoryDir)
        .filter(f => f.endsWith('.md'))
        .sort()
        .reverse()
    } catch (err) {
      return []
    }
  }

  /**
   * Search memory files for a query (simple text search)
   */
  searchMemory(query) {
    const results = []
    const queryLower = query.toLowerCase()

    const longTerm = this.readLongTermMemory()
    if (longTerm && longTerm.toLowerCase().includes(queryLower)) {
      results.push({
        file: 'MEMORY.md',
        matches: this.extractMatches(longTerm, query)
      })
    }

    for (const file of this.listDailyFiles().slice(0, 30)) {
      const content = this.readFile(path.join(this.memoryDir, file))
      if (content && content.toLowerCase().includes(queryLower)) {
        results.push({
          file: `memory/${file}`,
          matches: this.extractMatches(content, query)
        })
      }
    }

    return results
  }

  /**
   * Extract matching lines from content
   */
  extractMatches(content, query) {
    const lines = content.split('\n')
    const queryLower = query.toLowerCase()
    const matches = []

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(queryLower)) {
        const start = Math.max(0, i - 1)
        const end = Math.min(lines.length, i + 2)
        matches.push({
          line: i + 1,
          context: lines.slice(start, end).join('\n')
        })
      }
    }

    return matches.slice(0, 5)
  }

  // ===========================================
  // Observation Memory (Layer 2)
  // ===========================================

  /**
   * Write an observation to the JSONL file
   * @param {Object} obs - { domain, fact, source? }
   */
  writeObservation(obs) {
    const entry = {
      date: new Date().toISOString(),
      domain: obs.domain || 'general',
      fact: obs.fact,
      source: obs.source || 'conversation'
    }

    try {
      const line = JSON.stringify(entry) + '\n'
      fs.appendFileSync(OBSERVATIONS_FILE, line, 'utf-8')
      // Invalidate observation cache
      this._observationCacheMtime = 0
      return true
    } catch (err) {
      console.error('[Memory] Failed to write observation:', err.message)
      return false
    }
  }

  /**
   * Write multiple observations at once
   * @param {Array} observations - [{ domain, fact, source? }, ...]
   */
  writeObservations(observations) {
    if (!observations || !observations.length) return 0

    let written = 0
    for (const obs of observations) {
      if (this.writeObservation(obs)) written++
    }
    return written
  }

  /**
   * Read all observations
   * @returns {Array} Array of observation objects
   */
  readAllObservations() {
    try {
      if (!fs.existsSync(OBSERVATIONS_FILE)) return []

      // Check file mtime for cache invalidation
      const stat = fs.statSync(OBSERVATIONS_FILE)
      const mtime = stat.mtimeMs

      if (this._observationCache && mtime === this._observationCacheMtime) {
        return this._observationCache
      }

      const raw = fs.readFileSync(OBSERVATIONS_FILE, 'utf-8').trim()
      if (!raw) return []

      this._observationCache = raw.split('\n').map(line => {
        try { return JSON.parse(line) } catch { return null }
      }).filter(Boolean)
      this._observationCacheMtime = mtime

      return this._observationCache
    } catch (err) {
      console.error('[Memory] Failed to read observations:', err.message)
      return []
    }
  }

  /**
   * Search observations by keyword(s)
   * Returns matching observations sorted by relevance (recency + keyword match count)
   * @param {string} query - Space-separated keywords
   * @param {number} limit - Max results (default 20)
   */
  searchObservations(query, limit = 20) {
    const observations = this.readAllObservations()
    if (!observations.length || !query) return []

    const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 2)
    if (!keywords.length) return observations.slice(-limit)

    // Score each observation
    const scored = observations.map(obs => {
      const text = `${obs.domain} ${obs.fact} ${obs.source || ''}`.toLowerCase()
      let score = 0

      for (const kw of keywords) {
        if (text.includes(kw)) score += 1
        // Bonus for domain match
        if (obs.domain && obs.domain.toLowerCase().includes(kw)) score += 0.5
      }

      // Recency bonus: observations from today get +0.5, last 7 days get +0.25
      if (obs.date) {
        const age = Date.now() - new Date(obs.date).getTime()
        if (age < 86400000) score += 0.5       // today
        else if (age < 604800000) score += 0.25 // this week
      }

      return { obs, score }
    })

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(s => s.obs)
  }

  /**
   * Get relevant observations for a conversation context
   * Extracts keywords from the message and returns matching observations
   * @param {string} message - The incoming user message
   * @param {number} limit - Max observations to include
   */
  getRelevantObservations(message, limit = 10) {
    if (!message) return []

    // Extract meaningful words (skip common words)
    const stopwords = new Set(['the', 'is', 'at', 'in', 'on', 'to', 'for', 'of', 'and', 'or', 'a', 'an', 'it', 'do', 'did', 'was', 'are', 'be', 'has', 'have', 'had', 'will', 'can', 'could', 'would', 'should', 'may', 'might', 'this', 'that', 'with', 'from', 'what', 'when', 'where', 'how', 'who', 'which', 'my', 'your', 'his', 'her', 'our', 'their', 'me', 'him', 'them', 'we', 'you', 'they', 'just', 'also', 'very', 'about', 'been', 'some', 'any', 'all', 'get', 'got', 'not', "don't", "didn't", "won't", "can't"])

    const words = message.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopwords.has(w))

    if (!words.length) return []

    // Use top 5 meaningful words as search query
    const query = words.slice(0, 5).join(' ')
    return this.searchObservations(query, limit)
  }

  /**
   * Get observation context string for system prompt injection
   * @param {string} message - The incoming message for context matching
   */
  getObservationContext(message) {
    const relevant = this.getRelevantObservations(message, 8)
    if (!relevant.length) return ''

    const lines = ['## Relevant Past Observations']
    for (const obs of relevant) {
      const dateStr = obs.date ? new Date(obs.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
      lines.push(`- [${obs.domain}] ${obs.fact}${dateStr ? ` (${dateStr})` : ''}`)
    }

    return lines.join('\n')
  }

  /**
   * Count total observations
   */
  getObservationCount() {
    const all = this.readAllObservations()
    return all.length
  }

  /**
   * Get observation domains summary
   */
  getObservationDomains() {
    const all = this.readAllObservations()
    const domains = {}
    for (const obs of all) {
      const d = obs.domain || 'general'
      domains[d] = (domains[d] || 0) + 1
    }
    return domains
  }
}
