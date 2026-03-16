# Atlas: Operations Command Center for Flood Doctor

## Context

Frank Darakhshan is President of Flood Doctor LLC, a water damage restoration company in Northern Virginia/DC/Maryland. He is 100% admin — never goes to job sites. His crews do the field work. Frank's job is:

- Writing Xactimate invoices from crew field data (90% of his time)
- Chasing insurance adjusters for payment
- Pushing back when adjusters underpay
- Tracking 60+ active jobs and making sure nothing falls through cracks
- Managing SEO, marketing, website, and online presence
- Making sure the business captures every lead 24/7

**Frank works late nights (until ~5am), sleeps until ~10-11am.** Atlas must operate on HIS schedule.

**Atlas IS the operations hub.** It runs 24/7 as a launchd daemon on Frank's Mac mini. It answers team questions while Frank sleeps, tracks every job, nags about deadlines, and helps write invoices.

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

## Phase 1: Foundation (COMPLETE ✅)

| # | Feature | File | Status |
|---|---------|------|--------|
| 1 | Smart Model Routing | src/features/model-router.js | ✅ |
| 2 | Enhanced Task Capture | src/commands/handler.js | ✅ |
| 3 | Daily Briefing (10:30 AM) | src/features/morning-briefing.js | ✅ |
| 4 | Commitment Tracking | config/system-prompt.md | ✅ |
| 5 | Team Message Organizer | config/system-prompt.md + handler.js | ✅ |
| 6 | Calendar Alerts | src/features/calendar-alerts.js | ✅ |
| 7 | Email Triage Alerts | src/features/email-watcher.js | ✅ |
| 8 | Observation Memory Writer | src/memory/manager.js | ✅ |
| 9 | Observation Memory Reader | src/memory/manager.js + claude-agent.js | ✅ |
| 10 | End-of-Day Summary | src/features/daily-summary.js | ✅ |

## Phase 2: Job & Invoice Operations (COMPLETE ✅)

| # | Feature | File | Status |
|---|---------|------|--------|
| 11 | Job Tracker | src/features/job-tracker.js | ✅ |
| 12 | Deadline Enforcer | src/features/deadline-enforcer.js | ✅ |
| 13 | Xactimate Scope Assistant | src/features/scope-assistant.js | ✅ |
| — | 60 jobs imported from Drive | workspace/jobs.json | ✅ |
| — | Launchd daemon (24/7) | config/launchd/ | ✅ |
| — | /whereisfrank location | src/commands/handler.js | ✅ |

## Phase 3: Email & Document Automation (BUILD NEXT)

| # | Feature | File | What it does |
|---|---------|------|-------------|
| 14 | **Email Auto-Filer** | src/features/email-filer.js | When supervisor emails docs, Atlas downloads attachments, matches to a job by client name/address, files in the correct Google Drive project folder, logs: "Steve sent scopesheet for Wigenton. Filed in FD-002 folder." |
| 15 | **Payment Reminder Sender** | src/features/payment-nudge.js | `/job FD-002 nudge` → Atlas sends a professional payment reminder email from frank@flood.doctor to the client using the branded HTML template. Tracks when nudges were sent. |
| 16 | **Payment Recorder + Receipt** | src/features/payment-receipt.js | `/job FD-002 paid 8500` → Records payment in jobs.json, sends a branded receipt email to client, updates job status to "paid". |
| 17 | **Email Action Items** | src/features/email-actions.js | Enhances email triage: reads new emails and extracts action items — "Adjuster Smith needs moisture logs for FD-012 by Friday", "Steve sent updated scope for FD-002", "Insurance renewal due March 30". Categorizes as urgent/action/info. |

## Phase 4: CompanyCam Integration (BUILD NEXT)

| # | Feature | File | What it does |
|---|---------|------|-------------|
| 18 | **CompanyCam Timeline Builder** | src/features/companycam.js | `/timeline FD-002` → Pulls all photos from CompanyCam project via API. Builds daily timeline from photo timestamps: which techs, which days, what hours, normal vs after-hours. Counts equipment visible in photos using Claude vision. |
| 19 | **CompanyCam Webhook Listener** | src/features/companycam-webhook.js | Real-time: when a crew member uploads photos, Atlas gets notified immediately. Logs activity and can alert Frank if photos indicate issues. |

## Phase 5: Adjuster Management (BUILD NEXT)

| # | Feature | File | What it does |
|---|---------|------|-------------|
| 20 | **Adjuster Dispute Tracker** | src/features/adjuster-tracker.js | Track open claims per job: adjuster name/email, dispute status, documents requested, documents sent. `/job FD-002 dispute "adjuster denied 3 dehu days"` |
| 21 | **Adjuster Follow-up Automation** | src/features/adjuster-followup.js | Cron: checks which adjusters haven't responded in X days. Drafts professional follow-up emails with supporting documentation. `/job FD-002 followup` sends the email. |
| 22 | **Document Package Builder** | src/features/doc-packager.js | `/job FD-002 package` → Assembles all supporting docs for a claim: scope sheet, photos, moisture logs, labor log, equipment records from Drive folder. Organizes into a single email-ready package. |

## Phase 6: Business Intelligence (FUTURE)

| # | Feature | File | What it does |
|---|---------|------|-------------|
| 23 | **Revenue Dashboard** | src/features/revenue-dashboard.js | `/revenue` → Total invoiced, total collected, total outstanding, aging report. By month, by adjuster, by insurance company. |
| 24 | **Lien & Legal Tracker** | src/features/lien-tracker.js | Track lien filing deadlines, demand letters sent, legal escalation status. Auto-draft lien notices when deadline approaches. |
| 25 | **License & Insurance Monitor** | src/features/license-monitor.js | Track expiration dates for business licenses, insurance policies, certifications. Alert 30/14/7 days before expiry. |
| 26 | **Client Intake Bot** | src/features/intake-bot.js | When someone contacts Flood Doctor (form submission, email, WhatsApp), Atlas captures lead info, pre-qualifies, assigns to crew, starts a job record. |

---

## Constraints

| Rule | Why |
|------|-----|
| 1 feature = 1 file = 1 commit | Zero coupling. Peak quality. |
| Plugin architecture | Delete any feature file, Atlas still works. |
| No multi-file changes per feature | Bug in feature A cannot break feature B. |
| Simplest version first | No frameworks. No abstractions. |
| Use gws CLI for Google ops | Already authenticated. No new OAuth setup. |
| Use absolute paths | Prevent path traversal issues. |

---

## Critical Files

| File | Purpose |
|------|---------|
| src/gateway.js | Plugin loader + HTTP server + message routing |
| src/agent/claude-agent.js | Claude Agent SDK integration + system prompt |
| src/agent/runner.js | Queue-based agent run coordinator |
| src/memory/manager.js | Observation memory (JSONL) |
| src/commands/handler.js | Slash commands (/job, /todo, /scope, etc.) |
| src/features/ | Plugin directory — each feature = 1 file |
| config/system-prompt.md | Atlas personality and behavior rules |
| workspace/jobs.json | 60+ jobs with status, amounts, deadlines |

---

## Success Metrics

- Zero forgotten jobs. Zero missed lien deadlines.
- Zero uninvoiced completed work older than 7 days.
- Frank knows every morning: who owes money, what's overdue, what needs action.
- Scope assistant cuts invoice prep time by 50%+.
- Atlas answers team questions while Frank sleeps.
- Every document automatically filed in the right Drive folder.
- **Frank's 18-hour days become 10-hour days.**
