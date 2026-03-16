import fs from 'fs'
import path from 'path'
import { spawn, execSync } from 'child_process'

/**
 * Plugin Updater Feature
 * Atlas can review and improve its own features via Claude Code sessions.
 *
 * Commands:
 *   /atlas upgrade <feature>       - Analyze a feature, spawn CC session to fix
 *   /atlas upgrade all             - Review all features, create improvement plan
 *   /atlas diagnose "<problem>"    - Diagnose a bug from description
 *
 * Analysis checks:
 *   - Missing error handling (no try/catch)
 *   - Missing help text registration
 *   - No logging
 *   - Uses var instead of const/let
 *   - Missing standard register export
 *   - Large file (>300 lines) without sections
 *   - Hardcoded paths that should be constants
 */

const ROOT = '/Users/ghost/Projects/cc-wag'
const FEATURES_DIR = path.join(ROOT, 'src/features')
const AUDIT_FILE = path.join(ROOT, 'workspace', 'cc-audit.jsonl')

const DANGEROUS_PATTERNS = [
  /rm\s+-rf/i, /curl.*\|.*sh/i, /wget.*\|.*sh/i, /eval\s*\(/i,
  /process\.env/i, /ANTHROPIC_API_KEY/i, /credentials/i, /\.env\b/i,
  /auth_whatsapp/i, /ssh\s+/i, /scp\s+/i, /rsync\s+/i
]

const MAX_TASK_LENGTH = 500

function validateTask(task) {
  if (!task || typeof task !== 'string') {
    return { valid: false, reason: 'Task must be a non-empty string' }
  }
  if (task.length > MAX_TASK_LENGTH) {
    return { valid: false, reason: `Task too long (${task.length} chars, max ${MAX_TASK_LENGTH})` }
  }
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(task)) {
      return { valid: false, reason: `Task contains blocked pattern: ${pattern.source}` }
    }
  }
  return { valid: true }
}

function auditLog(entry) {
  try {
    const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + '\n'
    fs.appendFileSync(AUDIT_FILE, line)
  } catch (err) {
    console.error('[PluginUpdater] Audit log failed:', err.message)
  }
}

// ── Analysis ─────────────────────────────────────────────────────────

function analyzeFeature(featureName) {
  const fileName = featureName.endsWith('.js') ? featureName : `${featureName}.js`
  const filePath = path.join(FEATURES_DIR, fileName)

  if (!fs.existsSync(filePath)) return null

  const code = fs.readFileSync(filePath, 'utf-8')
  const lines = code.split('\n')
  const issues = []
  const improvements = []

  // Check for common issues
  if (!code.includes('try')) {
    issues.push('No error handling (missing try/catch)')
  }

  if (code.includes('var ')) {
    issues.push('Uses var instead of const/let')
  }

  if (!code.includes('export function register')) {
    issues.push('Missing standard register(gateway) export')
  }

  // Check for JSDoc
  if (!code.includes('/**')) {
    improvements.push('No JSDoc comments — add module-level documentation')
  }

  // Check for hardcoded workspace path without constant
  const workspaceRefs = (code.match(/\/Users\/ghost\/Projects\/cc-wag\/workspace/g) || []).length
  const hasWorkspaceConst = code.includes("const WORKSPACE") || code.includes("WORKSPACE =")
  if (workspaceRefs > 1 && !hasWorkspaceConst) {
    improvements.push('Hardcoded workspace paths — extract to WORKSPACE constant')
  }

  // Large file without section markers
  if (lines.length > 300 && !code.includes('\u2500\u2500')) {
    improvements.push('Large file (>300 lines) without section separators')
  }

  // No logging at all
  if (!code.includes('console.log') && !code.includes('console.error')) {
    improvements.push('No logging — add at least startup and error logging')
  }

  // Check for missing help extension
  if (!code.includes('handleHelp') && !code.includes('/help')) {
    improvements.push('Not registered in /help output')
  }

  // Check for interval timers without cleanup reference
  if (code.includes('setInterval') && !code.includes('clearInterval') && !code.includes('_timer') && !code.includes('Timer')) {
    improvements.push('setInterval without cleanup reference — potential memory leak')
  }

  return {
    fileName,
    filePath,
    lineCount: lines.length,
    issues,
    improvements,
    hasTests: false, // No test files in this project
    score: Math.max(0, 100 - (issues.length * 15) - (improvements.length * 5))
  }
}

function analyzeAllFeatures() {
  if (!fs.existsSync(FEATURES_DIR)) return []

  const files = fs.readdirSync(FEATURES_DIR).filter(f => f.endsWith('.js'))
  const results = []

  for (const file of files) {
    const analysis = analyzeFeature(file)
    if (analysis) results.push(analysis)
  }

  results.sort((a, b) => a.score - b.score)
  return results
}

// ── CC Session Spawning ──────────────────────────────────────────────

function spawnCCSession(prompt, gateway) {
  try {
    // Check if gateway has a CC spawner
    if (gateway._ccSpawner && typeof gateway._ccSpawner.spawn === 'function') {
      gateway._ccSpawner.spawn(prompt)
      return true
    }

    // Fall back to direct spawn
    const child = spawn('claude', ['-p', prompt, '--dangerously-skip-permissions'], {
      cwd: ROOT,
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY }
    })
    child.unref()
    auditLog({ action: 'spawn', prompt: prompt.substring(0, 200), result: 'spawned' })
    return true
  } catch (err) {
    console.error('[PluginUpdater] Failed to spawn CC session:', err.message)
    return false
  }
}

// ── Command Handlers ─────────────────────────────────────────────────

function handleUpgradeFeature(featureName, gateway) {
  const analysis = analyzeFeature(featureName)

  if (!analysis) {
    // List available features
    const files = fs.readdirSync(FEATURES_DIR).filter(f => f.endsWith('.js')).map(f => f.replace('.js', ''))
    return `Feature "${featureName}" not found.\n\nAvailable features:\n${files.map(f => `- ${f}`).join('\n')}`
  }

  const allIssues = [...analysis.issues, ...analysis.improvements]

  if (!allIssues.length) {
    return `${analysis.fileName} looks good! Score: ${analysis.score}/100, ${analysis.lineCount} lines. No issues found.`
  }

  const lines = [
    `\uD83D\uDD27 *Analysis: ${analysis.fileName}*`,
    `Score: ${analysis.score}/100 | ${analysis.lineCount} lines`,
    ''
  ]

  if (analysis.issues.length) {
    lines.push('*Issues:*')
    analysis.issues.forEach(i => lines.push(`\u274C ${i}`))
    lines.push('')
  }

  if (analysis.improvements.length) {
    lines.push('*Improvements:*')
    analysis.improvements.forEach(i => lines.push(`\uD83D\uDCA1 ${i}`))
    lines.push('')
  }

  // Build CC prompt
  const ccPrompt = [
    `Review and improve the Atlas feature file at ${analysis.filePath}.`,
    '',
    'Issues to fix:',
    ...allIssues.map(i => `- ${i}`),
    '',
    'Rules:',
    '- ESM project (import/export, no require)',
    '- Keep the register(gateway) pattern',
    '- Use absolute paths for file operations',
    '- Add try/catch around file operations',
    '- Add console.log for feature startup',
    '- Do NOT change feature behavior, only improve code quality',
    '- Commit changes when done'
  ].join('\n')

  lines.push('Spawning CC session to fix...')

  const spawned = spawnCCSession(ccPrompt, gateway)
  if (!spawned) {
    lines.pop()
    lines.push('Failed to spawn CC session. Fix manually or retry.')
  }

  return lines.join('\n')
}

function handleUpgradeAll() {
  const results = analyzeAllFeatures()

  if (!results.length) return 'No features found in src/features/'

  const needsWork = results.filter(r => r.issues.length > 0 || r.improvements.length > 0)
  const avgScore = Math.round(results.reduce((s, r) => s + r.score, 0) / results.length)

  const lines = [
    '\uD83D\uDD27 *Feature Health Report*',
    '\u2501'.repeat(22),
    '',
    `${results.length} features analyzed | Average score: ${avgScore}/100`,
    ''
  ]

  if (!needsWork.length) {
    lines.push('All features look good!')
    return lines.join('\n')
  }

  lines.push(`${needsWork.length} features need attention:`)
  lines.push('')

  // Show top issues
  for (const r of needsWork.slice(0, 10)) {
    const totalIssues = r.issues.length + r.improvements.length
    const topIssue = r.issues[0] || r.improvements[0] || ''
    lines.push(`\u2022 ${r.fileName} \u2014 ${r.score}/100 (${totalIssues} issues)`)
    if (topIssue) lines.push(`  ${topIssue}`)
  }

  if (needsWork.length > 10) {
    lines.push(`\n+${needsWork.length - 10} more features`)
  }

  lines.push('')
  lines.push('Run /atlas upgrade <feature> to fix a specific feature')

  return lines.join('\n')
}

function handleDiagnose(problem, gateway) {
  if (!problem) {
    return 'Usage: /atlas diagnose "description of the problem"'
  }

  // Validate problem string
  const validation = validateTask(problem)
  if (!validation.valid) {
    auditLog({ action: 'diagnose', problem, result: 'rejected', reason: validation.reason })
    return `Diagnosis rejected: ${validation.reason}`
  }

  // Search codebase for relevant code
  const searchTerms = problem.toLowerCase().split(/\s+/).filter(w => w.length > 3)
  const relevantFiles = []

  try {
    const files = fs.readdirSync(FEATURES_DIR).filter(f => f.endsWith('.js'))
    for (const file of files) {
      const code = fs.readFileSync(path.join(FEATURES_DIR, file), 'utf-8').toLowerCase()
      const matches = searchTerms.filter(term => code.includes(term)).length
      if (matches > 0) {
        relevantFiles.push({ file, matches })
      }
    }
    relevantFiles.sort((a, b) => b.matches - a.matches)
  } catch (err) {
    console.error('[PluginUpdater] Search failed:', err.message)
  }

  const lines = [
    `\uD83D\uDD0D *Diagnosing:* "${problem}"`,
    ''
  ]

  if (relevantFiles.length) {
    lines.push('Potentially related files:')
    for (const rf of relevantFiles.slice(0, 5)) {
      lines.push(`\u2022 ${rf.file} (${rf.matches} keyword matches)`)
    }
    lines.push('')
  }

  // Build CC diagnostic prompt
  const ccPrompt = [
    `Diagnose this problem in the Atlas WhatsApp bot codebase at ${ROOT}:`,
    '',
    `Problem: ${problem}`,
    '',
    relevantFiles.length ? `Start by examining: ${relevantFiles.slice(0, 3).map(f => f.file).join(', ')}` : 'Search src/features/ for relevant code.',
    '',
    'Rules:',
    '- Read the relevant files first',
    '- Identify the root cause',
    '- Fix the issue if possible',
    '- Commit with a descriptive message',
    '- If you cannot fix it, explain what you found'
  ].join('\n')

  const spawned = spawnCCSession(ccPrompt, gateway)
  if (spawned) {
    lines.push('Spawned CC session to investigate and fix.')
  } else {
    lines.push('Could not spawn CC session. Investigate manually.')
  }

  return lines.join('\n')
}

// ── Router ───────────────────────────────────────────────────────────

function handleAtlasUpgrade(text, gateway) {
  const body = text.replace(/^\/atlas\s+(upgrade|diagnose)\s*/i, '').trim()
  const lower = text.trim().toLowerCase()

  if (lower.startsWith('/atlas diagnose')) {
    const problem = text.replace(/^\/atlas\s+diagnose\s*/i, '').trim().replace(/^["']|["']$/g, '')
    return handleDiagnose(problem, gateway)
  }

  if (lower === '/atlas upgrade all') {
    return handleUpgradeAll()
  }

  if (lower.startsWith('/atlas upgrade')) {
    const feature = body.replace(/^all\s*/i, '').trim()
    if (!feature) {
      return handleUpgradeAll()
    }
    return handleUpgradeFeature(feature, gateway)
  }

  return null
}

// ── Register ─────────────────────────────────────────────────────────

export function register(gateway) {
  const originalExecute = gateway.commandHandler.execute.bind(gateway.commandHandler)

  gateway.commandHandler.execute = async function (text, sessionKey, adapter, chatId) {
    const lower = text.trim().toLowerCase()

    if (lower.startsWith('/atlas upgrade') || lower.startsWith('/atlas diagnose')) {
      const response = handleAtlasUpgrade(text.trim(), gateway)
      if (response) return { handled: true, response }
    }

    return originalExecute(text, sessionKey, adapter, chatId)
  }

  // Expose API
  gateway._pluginUpdater = {
    analyzeFeature,
    analyzeAllFeatures,
    spawnCCSession: (prompt) => spawnCCSession(prompt, gateway)
  }

  console.log('[PluginUpdater] Feature loaded — /atlas upgrade|diagnose commands')
}
