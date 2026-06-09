#!/usr/bin/env node
/**
 * Atlas Monitor — live activity dashboard for the CC-WAG gateway.
 *
 * Proves messages are actually flowing (sent AND received), not just queued,
 * and that the daemon, tunnel, HTTP server, and scheduled jobs are alive.
 *
 * Sources of truth:
 *   - /health        → daemon HTTP, WhatsApp adapter, queued count, uptime
 *   - launchctl      → gateway + tunnel daemon liveness (pid)
 *   - transcripts/   → timestamped record of every message in/out (THE proof)
 *   - logs/*.log     → live event feed (received, sent, queue, jobs, errors)
 *
 * Run:  node scripts/atlas-monitor.js        (or ./scripts/atlas-monitor.js)
 * Keys: q quit · v verbose (show all log lines) · c clear feed · p pause feed
 */

import fs from 'fs'
import path from 'path'
import http from 'http'
import readline from 'readline'
import { spawn, spawnSync } from 'child_process'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const LOG_DIR = path.join(ROOT, 'logs')
const GATEWAY_LOG = path.join(LOG_DIR, 'gateway.log')
const ERROR_LOG = path.join(LOG_DIR, 'gateway-error.log')
const TRANSCRIPT_DIR = path.join(ROOT, 'transcripts')

const GATEWAY_LABEL = 'com.flooddoctor.cc-wag'
const TUNNEL_LABEL = 'com.flooddoctor.atlas-tunnel'

const PORT = readGatewayPort()
const HEALTH_URL = `http://127.0.0.1:${PORT}/health`

// Scheduled jobs we expect to see firing. Tag in log → friendly name.
const JOBS = {
  MorningBriefing: 'Morning Briefing',
  DailySummary: 'Daily Summary',
  AdjusterFollowup: 'Adjuster Follow-up',
  AdjusterTracker: 'Adjuster Tracker',
  LienTracker: 'Lien Tracker',
  EquipmentTracker: 'Equipment Tracker',
  JobTracker: 'Job Tracker',
  LicenseMonitor: 'License Monitor',
  TokenMonitor: 'Token Monitor',
  HealthMonitor: 'Health Monitor',
  Cron: 'Cron Scheduler',
}

// ── ANSI ──────────────────────────────────────────────────────────────
const NC = process.env.NO_COLOR ? true : false
const C = (code) => (s) => (NC ? String(s) : `\x1b[${code}m${s}\x1b[0m`)
const dim = C('2'), bold = C('1')
const red = C('31'), grn = C('32'), yel = C('33'), blu = C('34'), mag = C('35'), cyn = C('36'), gry = C('90')
const bgRed = C('41;1;97'), bgYel = C('43;1;30'), bgGrn = C('42;1;30')

// ── State ─────────────────────────────────────────────────────────────
const state = {
  startedAt: nowMs(),
  health: { ok: false, connected: false, adapter: '?', uptime: 0, queued: 0, latency: null, err: null },
  daemon: { gateway: { up: false, pid: '-' }, tunnel: { up: false, pid: '-' } },
  tx: { recvTotal: 0, sentTotal: 0, recvToday: 0, sentToday: 0, lastRecv: null, lastSent: null },
  jobsSeen: {},          // name → wall-clock string when last seen live
  feed: [],              // ring buffer of {t, line}
  counters: { recv: 0, sent: 0, fail: 0 },  // since monitor start (live)
  lastSentLogMs: null,   // wall-clock of last observed outbound
  paused: false,
  verbose: false,
}
const FEED_MAX = 200
const txOffsets = new Map()  // file → {size, seededTotals}

// ── Helpers ───────────────────────────────────────────────────────────
function nowMs() {
  // Date.now is fine in a normal Node script (not a workflow sandbox).
  return Date.now()
}
function clock(ms = nowMs()) { return new Date(ms).toTimeString().slice(0, 8) }
function startOfTodayMs() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() }
function normTs(t) { if (!t) return null; t = Number(t); if (!isFinite(t)) return null; return t < 1e12 ? t * 1000 : t }
function ago(ms) {
  if (ms == null) return 'never'
  const s = Math.max(0, Math.floor((nowMs() - ms) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`
  return `${Math.floor(s / 86400)}d ago`
}
function dur(sec) {
  sec = Math.floor(sec)
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60)
  return `${d}d ${h}h ${m}m`
}
function clip(s, n) { s = String(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s }
function readGatewayPort() {
  try {
    const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
    const m = env.match(/^GATEWAY_PORT=(\d+)/m)   // only extract the port; never read/echo secrets
    if (m) return Number(m[1])
  } catch {}
  return Number(process.env.ATLAS_PORT) || 4096
}

// ── Pollers ───────────────────────────────────────────────────────────
function pollHealth() {
  const t0 = nowMs()
  const req = http.get(HEALTH_URL, { timeout: 2000 }, (res) => {
    let body = ''
    res.on('data', (c) => (body += c))
    res.on('end', () => {
      try {
        const j = JSON.parse(body)
        state.health = {
          ok: res.statusCode === 200,
          connected: !!j.whatsapp?.connected,
          adapter: j.whatsapp?.adapter || '?',
          uptime: j.uptime || 0,
          queued: j.queued ?? 0,
          latency: nowMs() - t0,
          err: null,
        }
      } catch (e) {
        state.health.ok = false; state.health.err = 'bad json'
      }
    })
  })
  req.on('timeout', () => { req.destroy(); state.health.ok = false; state.health.err = 'timeout'; state.health.latency = null })
  req.on('error', (e) => { state.health.ok = false; state.health.err = e.code || e.message; state.health.latency = null })
}

function pollDaemons() {
  try {
    const out = spawnSync('launchctl', ['list'], { encoding: 'utf8', timeout: 3000 }).stdout || ''
    for (const [label, key] of [[GATEWAY_LABEL, 'gateway'], [TUNNEL_LABEL, 'tunnel']]) {
      const line = out.split('\n').find((l) => l.includes(label))
      if (line) {
        const pid = line.split('\t')[0].trim()
        state.daemon[key] = { up: pid !== '-' && pid !== '', pid }
      } else {
        state.daemon[key] = { up: false, pid: '-' }
      }
    }
  } catch { /* leave previous */ }
}

function pollTranscripts() {
  let files = []
  try { files = fs.readdirSync(TRANSCRIPT_DIR).filter((f) => f.endsWith('.jsonl')) } catch { return }
  const todayStart = startOfTodayMs()
  let recvTotal = 0, sentTotal = 0, recvToday = 0, sentToday = 0
  let lastRecv = state.tx.lastRecv, lastSent = state.tx.lastSent
  for (const f of files) {
    const fp = path.join(TRANSCRIPT_DIR, f)
    let txt
    try { txt = fs.readFileSync(fp, 'utf8') } catch { continue }
    const lines = txt.split('\n')
    // cap to last 5000 lines for very large transcripts
    const slice = lines.length > 5000 ? lines.slice(-5000) : lines
    for (const ln of slice) {
      if (!ln.trim()) continue
      let o; try { o = JSON.parse(ln) } catch { continue }
      const ts = normTs(o.timestamp)
      if (o.role === 'user') {
        recvTotal++; if (ts && ts >= todayStart) recvToday++
        if (ts && (!lastRecv || ts > lastRecv.ts)) lastRecv = { ts, text: o.content, who: f.replace(/^agent_cc-wag_whatsapp_dm_/, '').replace(/_s_whatsapp_net\.jsonl$/, '').replace(/\.jsonl$/, '') }
      } else if (o.role === 'assistant') {
        sentTotal++; if (ts && ts >= todayStart) sentToday++
        if (ts && (!lastSent || ts > lastSent.ts)) lastSent = { ts, text: o.content }
      }
    }
  }
  state.tx = { recvTotal, sentTotal, recvToday, sentToday, lastRecv, lastSent }
}

// ── Log feed classification ───────────────────────────────────────────
const NOISE = [
  /\[Agent\] System prompt/, /\[ModelRouter\]/, /\[Agent\] Using tool/,
  /\[SessionHandoff\]/, /\[Agent\] /, /Processing\.\.\./,
]
function classify(line, source) {
  const raw = line.replace(/\s+$/, '')
  if (!raw.trim()) return null

  // errors first (from either log)
  if (/\bError:|Failed to send|Twilio error|error_code|ECONN|UnhandledPromise|\bException\b/i.test(raw)) {
    // ignore the noisy gws/google auth errors that aren't message-delivery failures
    const deliveryFail = /Twilio|sendMessage|Failed to send|\[WHATSAPP\]|\[Gateway\]|\[Queue\]/i.test(raw)
    state.counters.fail++
    return { type: 'ERR', icon: '✖', color: red, badge: bgRed(' ERROR '), text: clip(raw, 200), critical: deliveryFail }
  }
  // inbound
  if (/\[Twilio-Inbound\] From:|\] Incoming message:|\[Twilio\] Incoming:/.test(raw)) {
    state.counters.recv++
    const m = raw.match(/Body:\s*(.*)$|body="([^"]*)"/)
    return { type: 'RECV', icon: '📥', color: grn, badge: grn('RECV '), text: clip(m ? (m[1] || m[2] || raw) : raw, 120) }
  }
  // outbound delivered (reply path finished without throw)
  if (/\] Done$/.test(raw)) {
    state.counters.sent++; state.lastSentLogMs = nowMs()
    return { type: 'SENT', icon: '📤', color: cyn, badge: cyn('SENT '), text: 'reply delivered' }
  }
  if (/\bMessage sent\b|\bresponse sent\b|\bSent (daily|end-of-day|briefing|reply)/i.test(raw)) {
    state.counters.sent++; state.lastSentLogMs = nowMs()
    return { type: 'SENT', icon: '📤', color: cyn, badge: cyn('SENT '), text: clip(raw, 120) }
  }
  // queue lifecycle
  if (/\[Queue\] (Queued|Message queued)/.test(raw)) return { type: 'QUE', icon: '⏳', color: yel, badge: yel('QUEUE'), text: clip(raw.replace(/^\[Queue\]\s*/, ''), 80) }
  if (/\[Queue\] Processing/.test(raw)) return { type: 'PROC', icon: '⚙', color: blu, badge: blu('PROC '), text: clip(raw.replace(/^\[Queue\]\s*/, ''), 80) }
  if (/\[Queue\] Completed/.test(raw)) return { type: 'CMPL', icon: '✓', color: gry, badge: gry('DONE '), text: clip(raw.replace(/^\[Queue\]\s*/, ''), 80) }
  // scheduled jobs
  const jm = raw.match(/^\[([A-Za-z]+)\]/)
  if (jm && JOBS[jm[1]]) {
    state.jobsSeen[jm[1]] = clock()
    return { type: 'JOB', icon: '🔔', color: mag, badge: mag('JOB  '), text: clip(raw.replace(/^\[[A-Za-z]+\]\s*/, `${JOBS[jm[1]]}: `), 120) }
  }
  if (state.verbose) return { type: 'LOG', icon: '·', color: gry, badge: gry('log  '), text: clip(raw, 160) }
  if (NOISE.some((re) => re.test(raw))) return null
  return null
}

function pushFeed(ev) {
  if (!ev) return
  state.feed.push({ t: clock(), ev })
  if (state.feed.length > FEED_MAX) state.feed.shift()
  if (!state.paused) scheduleRender()
}

function tailFile(file, source) {
  if (!fs.existsSync(file)) return
  const child = spawn('tail', ['-n', '0', '-F', file], { stdio: ['ignore', 'pipe', 'ignore'] })
  let buf = ''
  child.stdout.on('data', (chunk) => {
    buf += chunk
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1)
      pushFeed(classify(line, source))
    }
  })
  child.on('error', () => {})
  return child
}

// ── Rendering ─────────────────────────────────────────────────────────
let renderQueued = false
function scheduleRender() {
  if (renderQueued) return
  renderQueued = true
  setImmediate(() => { renderQueued = false; render() })
}

function dot(up) { return up ? grn('●') : red('●') }
function width() { return Math.max(70, Math.min(process.stdout.columns || 100, 120)) }
function rule(label) {
  const w = width()
  if (!label) return gry('─'.repeat(w))
  const t = ` ${label} `
  return gry('─'.repeat(2)) + bold(t) + gry('─'.repeat(Math.max(0, w - t.length - 2)))
}

function alerts() {
  const a = []
  const h = state.health
  if (!state.daemon.gateway.up) a.push(bgRed(' DOWN ') + ' ' + red('Gateway daemon is NOT running'))
  if (!h.ok) a.push(bgRed(' DOWN ') + ' ' + red(`Gateway HTTP not responding (${h.err || 'no 200'})`))
  if (!state.daemon.tunnel.up) a.push(bgYel(' WARN ') + ' ' + yel('Cloudflare tunnel daemon not running (inbound webhooks may fail)'))
  if (h.ok && !h.connected) a.push(bgYel(' WARN ') + ' ' + yel(`WhatsApp adapter "${h.adapter}" reports not connected/configured`))
  if (h.queued > 0) {
    const stuck = state.lastSentLogMs && nowMs() - state.lastSentLogMs > 180000
    if (stuck) a.push(bgRed(' STUCK ') + ' ' + red(`${h.queued} queued and nothing sent in 3m+ — possible delivery stall`))
    else a.push(bgYel(' BUSY ') + ' ' + yel(`${h.queued} message(s) queued, awaiting send`))
  }
  // recent delivery failure in the live feed (last 5 min)
  const recentFail = state.feed.slice(-50).some((f) => f.ev.type === 'ERR' && f.ev.critical)
  if (recentFail) a.push(bgRed(' FAIL ') + ' ' + red('A delivery error appeared in the log — check feed'))
  return a
}

function render() {
  const w = width()
  const h = state.health
  const out = []
  const title = bold(cyn('🔱 ATLAS · CC-WAG GATEWAY MONITOR'))
  const right = dim(new Date().toLocaleString())
  out.push('\x1b[H\x1b[2J')   // home + clear
  out.push(title + ' '.repeat(Math.max(1, w - stripLen(title) - stripLen(right))) + right)
  out.push('')

  // ── Services
  out.push(rule('SERVICES'))
  out.push(`  ${dot(state.daemon.gateway.up)} Gateway daemon   ${pad(state.daemon.gateway.up ? grn('UP') : red('DOWN'), 6)} ${dim(GATEWAY_LABEL + ' · pid ' + state.daemon.gateway.pid)}`)
  out.push(`  ${dot(state.daemon.tunnel.up)} Cloudflare tunnel ${pad(state.daemon.tunnel.up ? grn('UP') : red('DOWN'), 5)} ${dim(TUNNEL_LABEL + ' · pid ' + state.daemon.tunnel.pid)}`)
  out.push(`  ${dot(h.ok)} HTTP :${PORT}      ${pad(h.ok ? grn('200') : red('DOWN'), 6)} ${dim((h.latency != null ? h.latency + 'ms' : (h.err || '—')))}`)
  out.push(`  ${dot(h.ok && h.connected)} WhatsApp (${h.adapter}) ${pad(h.connected ? grn('READY') : yel('NO'), 5)} ${dim('uptime ' + dur(h.uptime))}`)
  out.push('')

  // ── Message flow (the real proof)
  out.push(rule('MESSAGE FLOW  ' + dim('(timestamped transcript = ground truth)')))
  const lr = state.tx.lastRecv, ls = state.tx.lastSent
  out.push(`  ${grn('▼ Received')}  today ${bold(state.tx.recvToday)}  ·  total ${state.tx.recvTotal}`)
  out.push(`    last ${pad(lr ? ago(lr.ts) : 'never', 12)} ${dim(lr ? `[${lr.who}] ` : '')}${lr ? clip(lr.text, w - 30) : ''}`)
  out.push(`  ${cyn('▲ Sent')}      today ${bold(state.tx.sentToday)}  ·  total ${state.tx.sentTotal}`)
  out.push(`    last ${pad(ls ? ago(ls.ts) : 'never', 12)} ${ls ? clip(ls.text, w - 22) : dim('—')}`)
  const qColor = h.queued > 0 ? yel : gry
  out.push(`  ${qColor('◆ Queued now ' + h.queued)}   ${dim('live since start:')} recv ${state.counters.recv} · sent ${state.counters.sent} · ${state.counters.fail > 0 ? red('fail ' + state.counters.fail) : 'fail 0'}`)
  out.push('')

  // ── Scheduled jobs
  out.push(rule('SCHEDULED JOBS  ' + dim('(✓ seen live this session)')))
  const names = Object.keys(JOBS)
  for (let i = 0; i < names.length; i += 2) {
    const cells = [names[i], names[i + 1]].filter(Boolean).map((n) => {
      const seen = state.jobsSeen[n]
      const mark = seen ? grn('✓') : gry('·')
      const when = seen ? dim(seen) : gry('—')
      return `  ${mark} ${pad(JOBS[n], 20)} ${when}`
    })
    out.push(cells.join('   '))
  }
  out.push('')

  // ── Alerts
  const al = alerts()
  if (al.length) { out.push(rule('ALERTS')); al.forEach((a) => out.push('  ' + a)); out.push('') }

  // ── Live feed
  out.push(rule('LIVE FEED  ' + dim(state.paused ? '[PAUSED]' : '') + dim(state.verbose ? ' [verbose]' : '')))
  const rows = Math.max(6, (process.stdout.rows || 40) - out.length - 3)
  const slice = state.feed.slice(-rows)
  if (!slice.length) out.push(dim('  …waiting for activity (tailing gateway.log + gateway-error.log)…'))
  for (const { t, ev } of slice) {
    out.push(`  ${gry(t)} ${ev.badge} ${ev.color(clip(ev.text, w - 22))}`)
  }
  out.push('')
  out.push(dim(`  q quit · v verbose · c clear · p ${state.paused ? 'resume' : 'pause'}    monitoring ${ago(state.startedAt).replace(' ago', '')}`))

  process.stdout.write(out.join('\n'))
}

// strip ANSI for length math
function stripLen(s) { return String(s).replace(/\x1b\[[0-9;]*m/g, '').length }
function pad(s, n) { const l = stripLen(s); return l >= n ? s : s + ' '.repeat(n - l) }

// ── Boot ──────────────────────────────────────────────────────────────
function refresh() { pollHealth(); pollDaemons(); pollTranscripts(); scheduleRender() }

const children = [tailFile(GATEWAY_LOG, 'gw'), tailFile(ERROR_LOG, 'err')].filter(Boolean)
refresh()
const t1 = setInterval(refresh, 2000)
const t2 = setInterval(scheduleRender, 1000)  // keep "ago" timers fresh

// keys
if (process.stdin.isTTY) {
  readline.emitKeypressEvents(process.stdin)
  process.stdin.setRawMode(true)
  process.stdin.on('keypress', (_, key) => {
    if (!key) return
    if (key.name === 'q' || (key.ctrl && key.name === 'c')) return shutdown()
    if (key.name === 'v') { state.verbose = !state.verbose; scheduleRender() }
    if (key.name === 'c') { state.feed = []; scheduleRender() }
    if (key.name === 'p') { state.paused = !state.paused; scheduleRender() }
  })
}
process.stdout.on('resize', scheduleRender)

function shutdown() {
  clearInterval(t1); clearInterval(t2)
  children.forEach((c) => { try { c.kill() } catch {} })
  if (process.stdin.isTTY) process.stdin.setRawMode(false)
  process.stdout.write('\x1b[?25h\n')   // show cursor
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.stdout.write('\x1b[?25l')        // hide cursor
