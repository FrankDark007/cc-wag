# Atlas: Mobile Command Channel & Executive Organizer

## Context

Frank steps away from his desk constantly — driving, job sites, meetings. While mobile, he needs to:
- Capture ideas, tasks, and reminders before he forgets them
- Check on Claude Code sessions running on his Mac
- Receive organized updates from team members via WhatsApp
- Come back to his desk with everything sorted, prioritized, and ready to work on

**Atlas is NOT the primary work interface.** Heavy work happens in Claude Code sessions on the Mac.
Atlas is the **mobile bridge** — capturing inputs, organizing them, routing them, and keeping Frank informed when he's away.

---

## Architecture: Plugin System

Every feature follows this pattern:

```javascript
// src/features/example.js
export function register(gateway) {
  // Set up cron jobs, add commands, etc.
  // Called once at startup
}
```

Gateway.js auto-loads all features at startup.
**Delete any feature file → Atlas works without it. Zero coupling.**

---

## Week 1: Atlas Gets Smarter

| Session | Feature | File | Status |
|---------|---------|------|--------|
| 1 | Smart Model Routing | src/features/model-router.js | ✅ |
| 2 | Enhanced Task Capture | src/commands/handler.js | ✅ |
| 3 | Morning Briefing | src/features/morning-briefing.js | ✅ |
| 4 | Commitment Tracking | config/system-prompt.md | ✅ |
| 5 | Team Message Organizer | config/system-prompt.md + handler.js | ✅ |

## Week 2: Atlas Gets Proactive

| Session | Feature | File | Status |
|---------|---------|------|--------|
| 6 | Calendar Alerts | src/features/calendar-alerts.js | ✅ |
| 7 | Email Triage Alerts | src/features/email-watcher.js | ✅ |
| 8 | Observation Memory Writer | src/memory/manager.js | ✅ |
| 9 | Observation Memory Reader | src/memory/manager.js + claude-agent.js | ✅ |
| 10 | End-of-Day Summary | src/features/daily-summary.js | ✅ |

## Week 3+: Specialists & Domain Knowledge

Sessions 11-20+ (built only when Phase 1-2 is solid):
- Billing agent prompt, CompanyCam MCP, Xactimate knowledge
- Ops agent prompt, Job tracker, Weather alerts
- Growth agent prompt, Mission Control integration
- Voice transcription (Whisper), Document send/receive

---

## Critical Files

| File | Purpose |
|------|---------|
| src/gateway.js | Feature registration at startup |
| src/agent/claude-agent.js | Model routing + sub-agent spawning |
| src/memory/manager.js | Observation memory (read/write) |
| src/commands/handler.js | Task capture and slash commands |
| config/system-prompt.md | Atlas personality and behavior |
| src/features/ | Plugin directory (each feature = 1 file) |

---

## Constraints

| Rule | Why |
|------|-----|
| 1 session = 1 file = 1 commit | Zero compactions. Peak quality. |
| Plugin architecture | Each feature = 1 isolated file. Delete any, Atlas still works. |
| No multi-file changes | Bug in feature A cannot break feature B. |
| Simplest version first | No frameworks. No abstractions. |

---

## Success Metrics

- Frank gets morning briefing at 7:30 AM
- Simple questions answered in 1s (Haiku) vs 5s (Sonnet)
- "Remind me to..." while driving → task exists at desk
- Team messages → organized tasks waiting for Frank
- End-of-day summary shows what got done
- **Did Frank save time this week?**
