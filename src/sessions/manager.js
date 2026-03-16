import fs from 'fs'
import path from 'path'

const TRANSCRIPTS_DIR = '/Users/ghost/Projects/cc-wag/transcripts'

/**
 * Session manager with JSONL transcript storage
 */
export default class SessionManager {
  constructor() {
    this.sessions = new Map()
    this.ensureTranscriptsDir()
  }

  ensureTranscriptsDir() {
    if (!fs.existsSync(TRANSCRIPTS_DIR)) {
      fs.mkdirSync(TRANSCRIPTS_DIR, { recursive: true })
    }
  }

  /**
   * Get or create a session by key
   */
  getSession(key) {
    if (!this.sessions.has(key)) {
      this.sessions.set(key, {
        key,
        lastRunId: null,
        lastActivity: Date.now(),
        transcript: []
      })
    }
    const session = this.sessions.get(key)
    session.lastActivity = Date.now()
    return session
  }

  /**
   * Generate filename for a session's transcript
   */
  getTranscriptFilename(key) {
    const sanitized = key.replace(/[^a-zA-Z0-9_-]/g, '_')
    return path.join(TRANSCRIPTS_DIR, `${sanitized}.jsonl`)
  }

  /**
   * Append an entry to the session transcript
   */
  appendTranscript(key, entry) {
    const session = this.getSession(key)
    const timestampedEntry = {
      ...entry,
      timestamp: entry.timestamp || Date.now()
    }

    session.transcript.push(timestampedEntry)

    const filename = this.getTranscriptFilename(key)
    const line = JSON.stringify(timestampedEntry) + '\n'
    fs.appendFileSync(filename, line, 'utf-8')
  }

  /**
   * Get recent transcript entries for context
   */
  getTranscript(key, limit = 50) {
    const session = this.getSession(key)

    if (session.transcript.length === 0) {
      const filename = this.getTranscriptFilename(key)
      if (fs.existsSync(filename)) {
        try {
          const content = fs.readFileSync(filename, 'utf-8')
          const lines = content.trim().split('\n').filter(Boolean)
          session.transcript = lines.map(line => JSON.parse(line))
        } catch (err) {
          console.error(`Error loading transcript for ${key}:`, err)
        }
      }
    }

    return session.transcript.slice(-limit)
  }

  /**
   * Set the last run ID for a session
   */
  setLastRunId(key, runId) {
    const session = this.getSession(key)
    session.lastRunId = runId
  }

  /**
   * Get the last run ID for a session
   */
  getLastRunId(key) {
    const session = this.getSession(key)
    return session.lastRunId
  }
}
