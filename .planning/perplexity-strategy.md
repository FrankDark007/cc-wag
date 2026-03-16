# Perplexity Computer Strategic Analysis for Flood Doctor LLC

**Prepared for:** Frank Darakhshan, President, Flood Doctor LLC
**Date:** March 16, 2026
**Analysis by:** Claude Opus 4.6 via Claude Code

---

## 1. Executive Summary

**The bottom line:** Perplexity Computer is not a transformative tool for your business. It is a useful supplement in exactly two areas -- web research and content generation -- but it cannot touch your three biggest pain points (Xactimate invoicing, adjuster management, crew data collection). The $200/month is justifiable only if you commit to the SEO content empire strategy, where Sonar API + Claude Agent SDK is a better and cheaper path than Perplexity Computer itself.

**What to do with $200/month instead:**
- Encircle ($150-250/mo) would save you 10-15 hours/week on crew data collection and Xactimate scope writing
- Otterly.ai ($189/mo) would give you real AI search visibility tracking across all 13 cities
- Both together cost roughly the same as Perplexity Max and directly attack your #1 and #3 pain points

**The hybrid architecture answer:** Keep Claude Max ($200/mo) as your primary AI engine. Add Sonar API ($20-50/mo in actual usage) for real-time web search in Atlas and Mission Control. Skip Perplexity Max entirely. Your existing stack (Claude Code + Atlas + Mission Control) is architecturally superior to Perplexity Computer for every workflow you actually need.

**Personal Computer verdict:** The Mac mini version is on a waitlist, not generally available as of March 16, 2026. Even when it launches, running it on the same Mac mini as Atlas creates resource conflicts. It wants to own the machine. Atlas already does.

**Biggest opportunity you're missing:** It's not Perplexity. It's Encircle + CompanyCam optimization + Atlas-as-data-collector. This combination could cut your Xactimate writing time by 40-60%, worth 15-25 hours per week of your time back.

---

## 2. Perplexity Computer Deep Dive: Capabilities Mapped to YOUR Needs

### What Perplexity Computer Actually Is

A cloud-based multi-agent orchestration system. You describe a goal in plain text, Claude Opus 4.6 breaks it into subtasks, routes each to the best-fit model among 19 options, and returns results. Each task runs in an isolated Linux sandbox (2 vCPU, 8GB RAM, Firecracker microVM).

### Capability vs. Your Workflow Matrix

| Your Need | Perplexity Computer Can | Rating |
|-----------|------------------------|--------|
| Write Xactimate scopes | No. Cannot access Xactimate desktop app. No Xactimate API. | 0/10 |
| Manage adjuster communications | Partial. Can draft emails via Gmail connector but cannot track claims state. | 3/10 |
| SERP tracking across 13 cities | No persistent database. Tasks limited to 10 scheduled. Resets between sessions. | 2/10 |
| Blog content generation | Yes, but Sonar API + Claude is cheaper and more controllable. | 6/10 |
| Competitor intelligence | Good for one-off research. Cannot do automated weekly monitoring. | 5/10 |
| Google Ads management | Can research and plan. Cannot execute or optimize in Google Ads. | 4/10 |
| Crew data collection | No. Cannot interface with WhatsApp, CompanyCam, or field devices. | 0/10 |
| Website uptime monitoring | 10 task limit makes this impractical for 14+ domains. | 2/10 |
| AI search visibility | Can research strategies. Cannot track rankings programmatically. | 4/10 |
| Lead capture automation | No. Cannot run 24/7 webhooks or SMS/email auto-responders. | 0/10 |
| Deploy to Cloudflare Pages | No. Defaults to Vercel. Cannot use wrangler. | 0/10 |
| Code your projects | Yes, but Claude Code is better for your codebase. | 4/10 |

### Critical Limitations for Your Use Case

1. **No Xactimate integration.** Xactimate is a desktop app with no public API. Perplexity's sandbox is Linux -- Xactimate runs on Windows/Mac. This alone kills the #1 use case.

2. **No persistent database.** The sandbox resets between conversations. You can't store claim tracking data, SERP history, or adjuster correspondence logs. Mission Control with its JSON/file state store is actually ahead here.

3. **10 scheduled Tasks limit.** You have 13 cities + 2 brands + competitors. You'd burn through 10 tasks just monitoring a subset.

4. **Credits burn fast.** 10,000 credits/month. A single complex research task can consume 500-2,000 credits. Real-world users report burning through monthly allocation in 1-2 weeks of active use. One user reported a single task consuming 15,000-21,000 credits.

5. **Cloudflare deployment impossible.** Your entire city subdomain architecture runs on Cloudflare Pages via wrangler. Perplexity Computer deploys to Vercel only.

6. **No CompanyCam or WhatsApp integration.** No OAuth connectors for either. These are your two primary field data channels.

### What It's Actually Good For

- **One-off deep research projects** (competitor analysis, market research, pricing studies)
- **Multi-source report generation** (spawns 10+ parallel research sub-agents)
- **Draft content creation** (pulls real-time data, generates articles with citations)
- **Ad copy brainstorming** (can analyze competitor ads and suggest copy)

---

## 3. Mission Control: Keep, Replace, or Hybrid?

### The Honest Assessment

**Mission Control is 70% stubs.** After reviewing the codebase, the following critical services are all unimplemented stubs:

- `serpTrackerService.js` -- STUB
- `competitorIntelService.js` -- STUB
- `blogNetworkService.js` -- STUB
- `contentGapService.js` -- STUB
- `researchEngine.js` -- STUB
- `serpSchedulerService.js` -- STUB
- `seoAuditService.js` -- STUB
- `domainPortfolioService.js` -- STUB
- `deploymentService.js` -- STUB

**What actually works in MC:**
- Express server with React frontend
- MCP tool infrastructure (12 tools defined)
- State store and artifact system
- Ranking watchdog service (has real implementation)
- Agent manager (has real implementation)
- Basic route structure

### Recommendation: Hybrid -- Keep MC as UI Shell, Outsource Data

Don't replace MC. Don't try to make Perplexity Computer do what MC was supposed to do. Instead:

| MC Feature | Action | Tool |
|------------|--------|------|
| SERP position checking | Implement using Sonar API or Google Search API | Claude Code builds it |
| GSC data pulling | Already has routes -- just needs GSC OAuth tokens refreshed | Fix existing |
| GA4 integration | Same -- route exists, needs token refresh | Fix existing |
| Blog post generation | Implement with Claude API + Sonar API for research | Claude Code builds it |
| Location page generation | Already works via Astro + wrangler pipeline | Keep as-is |
| Parallel research agents | Implement using Claude Agent SDK multi-tool calls | Claude Code builds it |
| Historical SEO data | Add SQLite or JSON file storage to MC | Claude Code builds it |

**Estimated implementation time:** 3-4 days of focused Claude Code work to turn the stubs into real services.

**Why not Perplexity:** MC runs 24/7 on your Mac mini, stores data persistently, deploys to Cloudflare, and integrates with your exact stack. Perplexity Computer cannot do any of these things.

---

## 4. SEO Content Empire Blueprint

### The Strategy: 5-7 Niche Blogs Feeding Authority to flood.doctor

**Blog Network Architecture:**

| Blog | Domain | Focus | Target Keywords |
|------|--------|-------|-----------------|
| Water Damage Intel | waterdamageintel.com | Emergency water damage education | "water damage signs", "flooded basement what to do" |
| Mold Safety Hub | moldsafetyhub.com | Mold prevention, remediation, health | "black mold removal", "mold after water damage" |
| Insurance Claims Guide | insuranceclaimsguide.com | Homeowner insurance claims education | "water damage insurance claim", "adjuster underpaid my claim" |
| Home Restoration Blog | homerestorationblog.com | General restoration tips, DIY vs pro | "water damage repair cost", "when to call restoration company" |
| NoVA Home Services | novahomeservices.com | DC/MD/VA specific home emergency content | "[city] water damage", "[city] mold remediation" |

### Content Pipeline: n8n + Sonar API + Claude + WordPress

**Workflow (proven n8n templates exist):**

1. **Keyword Research** (weekly, automated)
   - n8n Schedule Trigger fires every Monday
   - Sonar API query: trending questions in water damage/restoration
   - Google Trends node pulls rising queries
   - Results saved to Google Sheet

2. **Content Generation** (2-3x per week per blog)
   - n8n pulls next keyword from sheet
   - Sonar API does deep research (pulls 5-10 sources, real-time data)
   - Claude API generates 1,500-2,500 word article with:
     - E-E-A-T signals (cite Xactimate pricing data, IICRC standards)
     - Local data (NoVA/DC/MD statistics, weather patterns)
     - Internal links back to flood.doctor service pages
   - Featured image from Pexels/Unsplash API
   - Auto-publish to WordPress as draft

3. **Quality Gate** (manual review 1x/week)
   - You spend 30 min reviewing 10-15 drafts
   - Add personal expertise, anecdotes, Flood Doctor branding
   - Approve for publication

4. **Distribution** (automated post-publish)
   - Auto-share to Google Business Profile
   - Cross-link between blogs in the network
   - Submit sitemap to GSC

### Cost Per Article at Scale

| Component | Cost |
|-----------|------|
| Sonar API research (per article) | $0.05-0.15 |
| Claude API content generation | $0.10-0.30 |
| WordPress hosting (per blog) | $5-15/mo (Cloudways or SiteGround) |
| Domain registration | $12/yr each |
| n8n self-hosted (on Mac mini) | Free |
| **Total per article** | **$0.15-0.45** |
| **Monthly cost (50 articles across 5 blogs)** | **$35-60 in API + $25-75 hosting** |

### Avoiding Google Penalties

Google's 2026 position: they don't penalize AI content; they penalize **low-quality** content. The key rules:

1. **Never publish without human review.** Add your expertise in every article.
2. **Unique value per page.** Don't just swap city names. Include local statistics, weather data, specific regulations (Virginia DPOR requirements, Maryland MHIC licensing).
3. **E-E-A-T signals.** Author bio with Frank Darakhshan credentials. Link to your DPOR license. Cite IICRC S500/S520 standards.
4. **Refresh content quarterly.** Pages updated within 2 months earn 28% more AI citations.
5. **Don't publish 100 pages overnight.** Ramp: 2-3/week for first month, then scale to 10-15/week.

### Can Perplexity Tasks Run This?

**No.** The 10-task limit means you'd use your entire allocation on 2 blogs. The n8n self-hosted approach is unlimited, runs on your Mac mini for free, and integrates with every tool in your stack.

---

## 5. Competitor Intelligence System Design

### The Competitors

| Competitor | Markets | Threat Level |
|------------|---------|-------------|
| ServPro | All 13 cities + national brand | High |
| ServiceMaster | DC metro wide | High |
| PurClean | Northern Virginia focus | Medium |
| VODA | VA/MD/DC aggressive marketing | Medium |
| Michael & Son | VA/MD/DC diversified services | Medium |

### Recommended Stack: Mission Control + Otterly.ai + Manual Perplexity Research

**Tier 1: AI Search Visibility (Otterly.ai -- $189/mo)**
- Track brand mentions across ChatGPT, Perplexity, Google AI Overviews, Gemini
- 100 prompts/month at Standard tier
- Configure prompts like "water damage cleanup [city] near me" for all 13 cities
- Track competitor citations alongside yours
- Brand Visibility Index gives you a single KPI to monitor

**Tier 2: Traditional SERP Tracking (Build into Mission Control)**
- Implement the SERP tracker stub using Google Custom Search API ($5/1000 queries)
- Track 50-100 keywords across 13 locations = ~650-1,300 queries/week
- Cost: ~$15-30/month in API fees
- Store in SQLite, display in MC dashboard

**Tier 3: Competitor Content Monitoring (Atlas + Sonar API)**
- Weekly Sonar API query: "What new pages has [competitor domain] published?"
- Atlas sends you a WhatsApp summary every Monday morning
- Cost: <$1/month in API calls

**Why not Perplexity Computer for this:**
- Cannot store historical data between sessions
- 10 scheduled tasks = not enough for 5 competitors x 13 cities
- Otterly.ai is purpose-built for exactly this job

**Why not dedicated tools like SE Ranking ($39-119/mo) or Ahrefs ($99-199/mo):**
- You're not a full-time SEO professional. You need monitoring, not analysis tools.
- Otterly.ai + MC implementation covers 80% of what you need at lower cost.
- If you decide to go deeper later, SE Ranking integrates well.

---

## 6. Google Ads Launch Plan

### The Reality Check

Water damage restoration is one of the most expensive Google Ads verticals in existence:

| Keyword | Estimated CPC | Monthly Search Volume (DC Metro) |
|---------|--------------|--------------------------------|
| "water damage restoration" | $150-250 | 1,000-2,000 |
| "water damage restoration near me" | $200-350 | 500-1,000 |
| "emergency water damage" | $175-300 | 300-600 |
| "flooded basement cleanup" | $75-150 | 200-400 |
| "mold remediation [city]" | $50-100 | 100-300 |
| "water damage repair" | $100-200 | 400-800 |

At $250 CPC and 30% click-to-lead conversion, that's **$833 per lead.** But a typical water damage job generates $3,000-$15,000 in revenue. If 1 in 3 leads converts to a job, your effective cost-per-acquisition is ~$2,500 against a $7,000+ average job value. The math works, but requires careful budget management.

### Recommended Approach: Google Local Service Ads First, Then Search

**Phase 1: Google Local Service Ads (Start immediately)**
- Pay-per-lead model: $35-100 per lead (vs $250+ CPC for Search Ads)
- "Google Guaranteed" badge builds trust
- Shows at the very top of search results
- Requirements: background check, insurance verification, licensing
- Estimated monthly budget: $500-1,500 to start
- Expected leads: 10-30/month

**Phase 2: AI Max for Search Campaigns (Month 2-3)**
- Google's newest ad format, 14% more conversions on average
- "Locations of Interest" targeting: catches people searching "water damage [your city]" from anywhere
- Start with 5-10 lower-CPC keywords:
  - "mold remediation [city]" ($50-100 CPC)
  - "water damage repair cost" ($75-125 CPC)
  - "basement flooding help" ($50-100 CPC)
- Estimated monthly budget: $1,000-3,000
- Let AI Max optimize for 30 days before expanding

**Phase 3: Full Campaign (Month 4+)**
- Add high-value emergency keywords
- Retargeting campaigns for website visitors who didn't convert
- Estimated monthly budget: $3,000-5,000

### Can Perplexity Computer Help with Google Ads?

**Partially.** It can:
- Research competitor ad copy and landing pages
- Generate ad headlines and descriptions
- Analyze keyword opportunities

It cannot:
- Connect to Google Ads API
- Optimize bids or budgets
- Monitor campaign performance in real-time
- Make bid adjustments

**Better approach:** Use Claude to draft ad copy, use Google's built-in AI Max features for optimization.

### ROI Projection

| Metric | Conservative | Moderate | Aggressive |
|--------|-------------|----------|-----------|
| Monthly ad spend | $1,000 | $3,000 | $5,000 |
| Leads generated | 15 | 40 | 65 |
| Jobs converted (30%) | 5 | 12 | 20 |
| Average job value | $5,000 | $7,000 | $7,000 |
| Monthly revenue | $25,000 | $84,000 | $140,000 |
| ROI | 25:1 | 28:1 | 28:1 |

---

## 7. Xactimate Acceleration Strategy (The 90% Problem)

### The Current Bottleneck

1. Crews go to job site
2. They take photos (CompanyCam), moisture readings (manual), measurements (tape measure)
3. Data arrives to you incomplete, unstructured, often days late
4. You spend hours chasing missing info (room dimensions, material types, water category, equipment placement)
5. You manually translate field data into Xactimate line items
6. You write the scope, apply pricing, calculate O&P, handle depreciation
7. Total time per invoice: 3-8 hours depending on job complexity

### What AI CAN Do Today

**A. Pre-Scope Data Structuring (Atlas + Claude)**

Build an Atlas workflow where crews send job data via WhatsApp:

```
Crew sends: "CC, new job data for Smith residence"
Atlas prompts: "Got it. Send me the following one at a time:
1. Water category (1, 2, or 3)
2. Water class (1-4)
3. Affected rooms (list each)
4. Moisture readings per room (material: reading)
5. Equipment placed (type and quantity per room)
6. Photos (send all via CompanyCam tag)"

Atlas structures this into a JSON template that feeds into your Xactimate workflow.
```

**Implementation:** Add a `/scope` command to Atlas that guides crews through structured data collection via WhatsApp. Each response is validated and stored. When complete, Atlas generates a formatted scope brief.

**Time to build:** 2-3 days with Claude Code
**Time savings:** 1-2 hours per job (elimination of callback cycle)

**B. Scope Draft Generation (Claude + Xactimate Knowledge Base)**

What you can build:
1. Feed Claude a structured knowledge base of Xactimate line items, codes, and pricing rules
2. Input: structured field data from Atlas
3. Output: a line-by-line scope draft in plain text with Xactimate codes

Example output:
```
Room: Master Bedroom (12x14, 168 SF)
Category 2, Class 3

WTR DRYALL    - Remove water damaged drywall, 2' flood cut  [28 LF]
WTR MITIG     - Water extraction, large area                [168 SF]
WTR DRY       - Structural drying, 4 air movers + 1 dehu   [3 days]
WTR ANTIMCRB  - Anti-microbial treatment                    [168 SF]
WTR DEMO      - Remove & dispose carpet/pad                 [168 SF]
```

You still enter this into Xactimate manually, but the scope is pre-written. You're reviewing and adjusting, not writing from scratch.

**Time to build:** 1-2 weeks (requires building the Xactimate line item knowledge base)
**Time savings:** 2-4 hours per job

**C. Tools That Already Exist**

| Tool | What It Does | Price | Relevance |
|------|-------------|-------|-----------|
| **Encircle** | Field documentation app with moisture tracking, Xactimate sketch integration, drying logs, real-time sync | $150-250/mo | HIGH -- directly addresses crew data capture |
| **Encircle Hydro** | Guided water mitigation workflow, equipment tracking, automated drying reports | Included | HIGH -- exactly your use case |
| **RestorationAI** | Pre-written supplement items with Xactimate codes embedded, photo integration | Free trial, ~$99/mo | MEDIUM -- supplements, not full scopes |
| **ScopeAssist** | Mobile inspection app that generates Xactimate estimates in 60 seconds | Contact for pricing | MEDIUM -- built for roofing, adaptable |
| **XactScope** | Built into Xactimate Professional, guided prompts auto-create line items | Included with Xactimate Pro | HIGH -- if you're not using this already, start immediately |
| **Docusketch** | 3D scanning + automatic Xactimate sketch generation | $99-199/mo | MEDIUM -- reduces measurement time |

### The Recommended Stack for Xactimate Acceleration

**Priority 1 (This week):** Start using XactScope in Xactimate if you aren't already. It's included in your subscription and guides you through scoping with auto-generated line items.

**Priority 2 (This month):** Deploy Encircle for field crews. It captures moisture readings, photos, sketches, and drying logs in a structured format that syncs in real-time to your office. The Xactimate sketch integration alone saves hours per job.

**Priority 3 (Next month):** Build the Atlas `/scope` command for WhatsApp-based data collection as a complement to Encircle for crews who resist app adoption.

**Priority 4 (Ongoing):** Build the Claude-powered scope draft generator using your Xactimate line item knowledge base. This is a 1-2 week project that compounds in value over time.

### Can Perplexity Computer Help Here?

**No.** It cannot access Xactimate (desktop app, no API). It cannot interface with CompanyCam. It cannot receive WhatsApp messages from crews. It cannot store structured job data between sessions. This is 100% Claude Code + Atlas territory.

---

## 8. Adjuster Management & Collections System

### The Problem

Adjusters routinely:
- Delay responses for weeks
- Underpay by 20-30% below Xactimate regional pricing
- Deny specific line items without justification
- Request documentation they've already received
- Ignore follow-up emails

### System Design: Atlas + Claude + Google Workspace

**A. Claims Tracker (Build in Atlas or Mission Control)**

Create a structured claims database (Google Sheets or SQLite):

| Field | Purpose |
|-------|---------|
| Claim # | Insurance claim identifier |
| Client name | Property owner |
| Insurance company | Carrier name |
| Adjuster name + email | Point of contact |
| Date of loss | When damage occurred |
| Scope submitted date | When you sent the invoice |
| Amount invoiced | Your Xactimate total |
| Amount approved | What adjuster approved |
| Variance | Difference (auto-calculated) |
| Status | Submitted / Under Review / Disputed / Paid / Collections |
| Last contact date | When you last followed up |
| Next follow-up date | Auto-calculated: 5 business days after last contact |
| Documents sent | Checklist of photos, moisture logs, scope, contract |

**Atlas auto-follow-up workflow:**
```
Every morning at 9am:
1. Atlas checks claims tracker for items where next_follow_up <= today
2. For each overdue claim:
   a. Draft a professional follow-up email citing claim #, date submitted, days elapsed
   b. Send via frank@flood.doctor
   c. Update last_contact and next_follow_up in tracker
   d. Notify Frank via WhatsApp: "Sent follow-up on Smith claim #12345 (18 days since submission)"
```

**Time to build:** 3-4 days
**Time savings:** 3-5 hours per week in manual follow-up tracking

**B. Supplement Request Generator (Claude-powered)**

When an adjuster denies or underpays line items, Claude can draft professional pushback letters:

**Input:** denied line items, Xactimate pricing data, job documentation
**Output:** professional supplement request citing:
- IICRC S500/S520 standards requiring the work
- Xactimate regional pricing as market-standard benchmark
- Photographic evidence (referenced by filename/CompanyCam link)
- Moisture readings proving the scope of damage
- Virginia insurance regulations on prompt payment (15 calendar day acknowledgment requirement)

**RestorationAI's supplement tool** ($99/mo) already has hundreds of pre-written supplement items with Xactimate codes embedded. This is worth trying immediately -- their claim is 25-30% increase in recovery per job.

**Time to build custom system:** 1 week
**Or use RestorationAI:** Immediately, ~$99/mo

**C. Document Package Automation**

Atlas can compile document packages on demand:

```
"CC, compile adjuster package for Smith claim 12345"

Atlas:
1. Pulls photos from CompanyCam project tagged "Smith"
2. Pulls moisture logs from Encircle (or structured data file)
3. Pulls signed contract from Google Drive
4. Pulls Xactimate scope PDF from Drive
5. Compiles into single PDF or organized folder
6. Emails to adjuster with professional cover letter
```

**Time to build:** 2-3 days (requires CompanyCam API integration)
**Time savings:** 1-2 hours per document request

**D. Contract & Legal Monitoring**

| Need | Solution | Cost |
|------|----------|------|
| License expiration alerts | Atlas cron job checks DPOR license renewal dates, alerts 60/30/14 days before | Free (build it) |
| Insurance policy renewals | Same cron pattern with Google Calendar events | Free |
| Lien notice generation | Claude templates based on Virginia Code 43-4 (90-day filing deadline after last work date) | Free (build it) |
| Demand letters | Claude templates citing Virginia prompt payment law | Free (build it) |

Virginia mechanic's lien requirements for your reference:
- File memorandum of lien within 90 days of last day of month in which you last performed work
- Must include: owner name/address, claimant name/address, amount claimed, property description
- General contractor must file certification of mailing to owner at last known address
- Residential projects with Mechanic Lien Agent require 30-day preliminary notice

**AI-generated lien templates exist** (ailawyer.pro, ezel.ai) but should always be reviewed by your attorney before filing.

---

## 9. Crew Data Collection Redesign

### The Goal

Crews capture everything on-site so you NEVER call them back asking "what was the moisture reading in the master bedroom?"

### Current State Problems

1. Photos go to CompanyCam (good) but lack structured metadata
2. Moisture readings are handwritten on paper or texted randomly
3. Room dimensions are approximate or missing
4. Equipment placement logs are nonexistent
5. Water category/class determination is verbal, not documented
6. Timeline of work is reconstructed from memory

### The Redesigned System: Three Tiers

**Tier 1: Encircle (Deploy First -- Highest Impact)**

Encircle is purpose-built for exactly this problem:
- **Moisture readings**: Encircle Hydro has guided checklists for equipment setup and moisture readings, all logged digitally with timestamps
- **Drying logs**: Auto-generated reports of all moisture readings and drying progress
- **Floor plans**: Encircle Floor Plan captures room dimensions via phone scan, imports directly into Xactimate for instant sketches (replaces 2-hour on-site scoping with 15-20 minutes)
- **Photos/videos**: Organized by room, timestamped, synced in real-time
- **E-signatures**: Digital contract signing on-site
- **Real-time sync**: Everything appears in your office dashboard as crews capture it

**Key integration**: Encircle floor plans import directly into Xactimate for sketches. This alone could save you 1-2 hours per job.

**Cost:** $150-250/month depending on plan
**Crew adoption difficulty:** Medium -- requires training, but the app is designed for field techs with guided workflows
**Time savings:** 10-15 hours/week (estimated across all jobs)

**Tier 2: Atlas WhatsApp Data Collection (Complement to Encircle)**

For crews who resist new apps, Atlas becomes the data collection interface via WhatsApp:

```
Atlas /scope command workflow:

Crew: "Atlas, new scope data"
Atlas: "Starting scope. What's the property address?"
Crew: "1234 Main St Alexandria VA"
Atlas: "Got it. Water category? (1=clean, 2=gray, 3=black)"
Crew: "2"
Atlas: "Class? (1=minor, 2=significant, 3=major, 4=specialty)"
Crew: "3"
Atlas: "List affected rooms:"
Crew: "Master bedroom, hallway, bathroom"
Atlas: "Starting Master Bedroom. Dimensions?"
Crew: "12 by 14"
Atlas: "Moisture readings - send each as 'material: number':"
Crew: "drywall: 45, baseboard: 62, subfloor: 38"
Atlas: "Equipment placed?"
Crew: "3 air movers 1 dehu"
Atlas: "Send photos via CompanyCam tagged 'Smith 1234 Main'"
[continues for each room]
Atlas: "Scope data complete. Saved. Summary sent to Frank."
```

**Time to build:** 2-3 days
**Crew adoption difficulty:** Low -- they already use WhatsApp

**Tier 3: Voice-to-Scope (Future Enhancement)**

Speech recognition in 2026 is accurate enough for field use. Implementation:
1. Crew calls a dedicated phone number or sends voice notes to Atlas
2. Whisper API transcribes the audio
3. Claude parses the transcription into structured scope data
4. Structured data feeds into the same pipeline

This eliminates typing entirely. Crew walks through a room speaking: "Master bedroom, 12 by 14, drywall moisture 45 percent, baseboard 62, subfloor 38. Placed 3 air movers and 1 dehumidifier. Category 2, class 3."

**Time to build:** 1-2 weeks (audio processing + NLP parsing)
**Crew adoption difficulty:** Low -- speaking is easier than typing

### CompanyCam Optimization

CompanyCam has an open API. You should be using it for:
- **Auto-tagging photos by room** (configure project templates)
- **Pulling photos into Atlas** via API for document package compilation
- **Timeline reconstruction** (all photos are GPS + timestamp tagged)
- **API integration with Encircle** for unified documentation

Check if you've set up project templates in CompanyCam. If crews just dump photos without room labels, that's fixable with templates that force room-by-room organization.

---

## 10. SEO & AI Search Visibility Strategy

### The Landscape in 2026

Three AI engines now drive significant referral traffic, and they cite sources differently:

| Engine | Citation Preference | What to Optimize |
|--------|-------------------|------------------|
| **Google Gemini/AI Overviews** | 52% citations from brand-owned websites. Favors schema markup, local landing pages, consistent subdomains. | Your city subdomain architecture ({city}.flood.doctor) is perfectly positioned. Add schema. |
| **ChatGPT** | Trusts third-party consensus. Favors directory listings, reviews, consistent info across platforms. | Get listed on every directory. Ensure NAP consistency. Stack Google reviews. |
| **Perplexity** | Trusts experts and reviews. Prefers recent, citation-heavy content. | Publish authoritative content with statistics, IICRC citations, and keep it updated. |

### Immediate Actions (This Week)

**1. Schema Markup on All Properties**

Add JSON-LD to flood.doctor and all 13 city subsites:

```json
{
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "name": "Flood Doctor",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "8466D Tyco Rd",
    "addressLocality": "Vienna",
    "addressRegion": "VA",
    "postalCode": "22182"
  },
  "telephone": "(877) 497-0007",
  "url": "https://flood.doctor",
  "areaServed": ["Alexandria", "Arlington", "Fairfax", ...],
  "hasOfferCatalog": {
    "@type": "OfferCatalog",
    "name": "Water Damage Services",
    "itemListElement": [
      {"@type": "Service", "name": "Emergency Water Extraction"},
      {"@type": "Service", "name": "Structural Drying"},
      {"@type": "Service", "name": "Mold Remediation"}
    ]
  }
}
```

Add `FAQPage` schema to each city page with emergency-specific questions:
- "How quickly can Flood Doctor respond in [city]?"
- "What should I do if my basement floods?"
- "Does homeowners insurance cover water damage?"

**2. Content Freshness**

Pages updated within 2 months earn 28% more AI citations. Set a quarterly refresh schedule for all city pages.

**3. E-E-A-T Signals**

- Author bio on every blog post: "Frank Darakhshan, IICRC-certified water damage restoration specialist, 10+ years experience"
- Link to DPOR license page
- Cite IICRC S500 (water damage) and S520 (mold) standards in content
- Display Google review count prominently

**4. AI-Specific Optimization**

Content with statistics and citations achieves 30-40% higher visibility in AI responses:
- Include specific data: "Flood Doctor responds within 60 minutes to emergency calls in Northern Virginia"
- Cite industry statistics: "The average water damage claim in Virginia is $11,098 (Insurance Information Institute, 2025)"
- Use clear, factual headings that AI can extract as answers

### Competitive Gap Analysis

Your competitors (ServPro, ServiceMaster) are national brands with massive content libraries but they are NOT optimizing for AI search citations yet. This is your window:

- ServPro has brand recognition but generic city pages with no unique content
- ServiceMaster has even less local content differentiation
- Neither has schema markup optimized for AI extraction
- Neither publishes authoritative expert content with IICRC citations

**Your advantage:** 13 unique city subsites with local content + expert authorship + schema markup = exactly what AI engines prefer to cite.

### AI Search Monitoring

Use Otterly.ai ($189/mo) to track:
- "water damage restoration [city]" across ChatGPT, Perplexity, Google AI Overviews
- Monitor if competitors get cited instead
- Track which of your pages get cited and why

---

## 11. Client Intake & 24/7 Lead Capture System

### The 2am Flooded Basement Flow

```
2:00 AM - Homeowner discovers flooded basement
2:01 AM - Searches "water damage cleanup near me" on Google/ChatGPT
2:02 AM - Finds flood.doctor (AI citation or Google result)
2:03 AM - Lands on website, sees emergency form + phone number
2:04 AM - Fills out form OR calls
2:05 AM - Atlas auto-responds via email + SMS within 60 seconds
2:06 AM - On-call crew lead gets WhatsApp alert from Atlas
2:10 AM - Crew lead calls homeowner
2:15 AM - Crew dispatched
2:30 AM - Contract signed via e-signature (Encircle or WP E-Signature)
```

### Components to Build

**A. Website Uptime Monitoring**

Deploy Uptime Kuma on your Mac mini (free, self-hosted):
- Monitor flood.doctor + all 13 city subsites every 60 seconds
- Alert via WhatsApp (Atlas) + SMS + email if any site goes down
- Dashboard at localhost:3001/uptime (or separate port)

**Time to deploy:** 1 hour
**Cost:** Free

**B. Service Request Form Auto-Response**

Option 1: **Atlas webhook integration**
- flood.doctor form submits to a webhook endpoint on your Mac mini
- Atlas receives the submission, parses it, and:
  1. Sends confirmation email to homeowner
  2. Sends WhatsApp alert to on-call crew
  3. Creates a Google Task for follow-up
  4. Logs the lead in a tracking sheet

Option 2: **Dedicated chatbot on flood.doctor**
- AI chatbot for after-hours lead capture
- Pre-qualifies leads: damage type, water source, service area, insurance info
- Captures name, phone, address, urgency level
- Tools to evaluate: Poly Chat Bot (restoration-specific), Tidio, Drift

**Recommended:** Option 1 (Atlas webhook) for immediate implementation, add chatbot later.

**Time to build Option 1:** 1-2 days
**Cost:** Free (uses existing Atlas infrastructure)

**C. AI Phone Answering (After-Hours)**

Multiple options exist but this is a risk area -- bad AI phone experiences lose emergency customers. Recommended approach:

- Use Google Local Service Ads which includes a messaging feature
- After-hours calls route to voicemail with "text us for immediate response" prompt
- Atlas monitors a dedicated SMS number (via Twilio) and auto-responds
- Keep it simple: capture name, phone, address, damage description

**Do not** deploy a conversational AI phone agent for emergency services. The homeowner is stressed, possibly standing in water. They want a human voice confirming help is coming.

**D. Automated Review Request System**

After job completion:
1. Crew marks job complete in system (or Frank marks invoice as paid)
2. 24 hours later, Atlas sends SMS to homeowner:
   "Hi [Name], Frank from Flood Doctor here. Thank you for trusting us with your home. If you were happy with our work, a Google review would mean the world to us: [direct review link]"
3. If no review after 72 hours, send one follow-up email with the same link
4. Stop after 2 attempts (don't be pushy)

Expected impact: 15-35% increase in review volume (5-15 new reviews/month)

**Time to build:** 1 day
**Cost:** Twilio SMS: ~$0.01/message

**E. Lead Pre-Qualification via Atlas**

When a service request comes in after hours, Atlas can pre-qualify:
```
Atlas: "Thank you for contacting Flood Doctor. To help us respond quickly:
1. What type of damage? (water/mold/fire/sewage)
2. Is the water source still active? (yes/no)
3. What's your zip code?
4. Do you have homeowners insurance? (yes/no)
5. Can you send a photo?"

[Atlas checks zip code against service area list]
[If out of area: "We don't currently serve [zip]. For immediate help, try [competitor]." -- Yes, refer them. It builds goodwill.]
[If in area + active water: EMERGENCY - alert on-call immediately]
[If in area + no active water: Schedule for morning crew]
```

---

## 12. Optimal Hybrid Architecture

### The Stack

```
┌─────────────────────────────────────────────────────────┐
│                    YOUR MAC MINI (M4)                     │
│                                                           │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │    ATLAS     │  │   MISSION    │  │  UPTIME KUMA   │  │
│  │  (CC-WAG)   │  │   CONTROL    │  │  (monitoring)  │  │
│  │  WhatsApp    │  │  SEO + ops   │  │  14 domains    │  │
│  │  24/7 daemon │  │  localhost:  │  │  60s checks    │  │
│  │             │  │  3001        │  │                │  │
│  └──────┬──────┘  └──────┬───────┘  └────────────────┘  │
│         │                │                                │
│  ┌──────┴──────┐  ┌──────┴───────┐  ┌────────────────┐  │
│  │    n8n      │  │   SQLite     │  │  CRON JOBS     │  │
│  │ (content    │  │  (SEO data,  │  │  (follow-ups,  │  │
│  │  pipeline)  │  │  claims      │  │   reviews,     │  │
│  │             │  │  tracker)    │  │   monitoring)  │  │
│  └─────────────┘  └──────────────┘  └────────────────┘  │
└─────────────────────────────────────────────────────────┘
                          │
              ┌───────────┴───────────┐
              │     EXTERNAL APIs      │
              │                        │
              │  Claude API (primary)  │
              │  Sonar API (search)    │
              │  Google APIs (GSC,GA4) │
              │  CompanyCam API        │
              │  Twilio (SMS)          │
              │  Google Ads API        │
              └────────────────────────┘
```

### Claude vs. Perplexity: Where Each Wins

| Capability | Claude (Max + API) | Perplexity (Max + Sonar) |
|-----------|-------------------|-------------------------|
| Code generation & editing | 10/10 -- Claude Code is best-in-class | 6/10 -- multi-model but less precise |
| Codebase understanding | 10/10 -- reads entire repos | 3/10 -- no local file access in Computer |
| Real-time web search | 3/10 -- no native search | 10/10 -- Sonar is purpose-built for this |
| Long-running research | 5/10 -- single model, manual | 9/10 -- parallel sub-agents, background execution |
| Xactimate scope writing | 7/10 -- can learn with knowledge base | 2/10 -- no desktop app access |
| WhatsApp integration | 10/10 -- Atlas exists, running now | 0/10 -- no WhatsApp connector |
| Cloudflare deployment | 10/10 -- wrangler via CLI | 0/10 -- Vercel only |
| Email automation | 8/10 -- Atlas + gws CLI | 6/10 -- Gmail connector, but manual |
| Persistent data storage | 9/10 -- SQLite, JSON, files | 2/10 -- sandbox resets between sessions |
| Scheduled automation | 9/10 -- cron, launchd, n8n | 3/10 -- 10 task limit |
| Cost control | 9/10 -- predictable API pricing | 4/10 -- opaque credit consumption |

### The $400/month Question

If you pay $200 for Claude Max AND $200 for Perplexity Max:

**Claude Max ($200/mo) gives you:**
- Unlimited Claude Code usage (your primary development tool)
- Atlas running 24/7 (WhatsApp, email, calendar, tasks)
- All custom tooling (MC, content pipeline, claims tracker)
- Precise, controlled, debuggable workflows

**Perplexity Max ($200/mo) would give you:**
- 10,000 credits for Computer (burns fast, opaque consumption)
- Unlimited Pro searches (nice for ad-hoc research)
- Perplexity Tasks (10 scheduled, useful but limited)
- Perplexity Spaces (file upload, custom instructions)
- Comet browser (free, no Max required)

**Verdict: You'd get maybe $50-75 of value from the $200 Perplexity Max subscription.** The only unique value is the parallel multi-model research, which you'd use maybe 2-3 times per week. Everything else either overlaps with Claude or doesn't apply to your workflows.

### The Optimal Hybrid: Claude Max + Sonar API

Instead of Perplexity Max ($200/mo), add Sonar API access ($20-50/mo actual usage):

```javascript
// In Atlas or Mission Control, add Sonar as a tool:
const sonarSearch = async (query) => {
  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SONAR_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'sonar',
      messages: [{ role: 'user', content: query }]
    })
  });
  return response.json();
};
```

This gives you real-time web search inside Claude's workflows for $1/million tokens instead of $200/month.

### Can Personal Computer Coexist with Atlas?

**Risky.** Perplexity Personal Computer wants persistent access to your Mac mini's files, apps, and sessions. It runs continuously. Atlas also runs continuously as a launchd daemon. Running both means:
- Resource competition on the M4 (2 always-on AI agents)
- File system conflicts (both want to manage files)
- Port conflicts (both run local servers)
- Security concerns (Perplexity PC sends data to Perplexity's servers)

If you want to try Personal Computer, dedicate a second Mac mini to it. Don't run it alongside Atlas.

---

## 13. Cost-Benefit Analysis

### Recommended Monthly Stack

| Tool | Monthly Cost | What It Does | Weekly Time Savings |
|------|-------------|-------------|-------------------|
| Claude Max | $200 | Primary AI engine, Claude Code, Atlas | Baseline -- already paying |
| Sonar API | $20-50 | Real-time web search in Atlas/MC | 2-3 hrs (replaces manual research) |
| Encircle | $150-250 | Crew field documentation, Xactimate integration | 10-15 hrs |
| Otterly.ai | $189 | AI search visibility tracking | 2-3 hrs |
| RestorationAI | $99 | Supplement request generation | 3-5 hrs |
| Twilio | $10-20 | SMS for lead capture and review requests | 1-2 hrs |
| n8n (self-hosted) | $0 | Content pipeline automation | 3-5 hrs |
| Uptime Kuma (self-hosted) | $0 | Website monitoring | 1 hr (peace of mind) |
| Blog hosting (5 blogs) | $50-75 | WordPress hosting for niche blogs | -- |
| Google LSA | $500-1,500 | Lead generation | Revenue impact |
| **Total new costs** | **$1,218-2,383/mo** | | **22-34 hrs/week saved** |

### What You're NOT Paying For

| Tool | Monthly Cost | Why Skip It |
|------|-------------|-------------|
| Perplexity Max | $200 | Sonar API at $20-50/mo gives you the only unique value |
| SE Ranking | $39-119 | Otterly.ai + MC SERP tracker covers your needs |
| Ahrefs | $99-199 | Overkill for your current SEO maturity |
| Perplexity Personal Computer | $200 (est.) | Waitlisted, resource conflict with Atlas, limited value |

### ROI Projection

**Time savings monetized** (your time is worth $100-200/hr as company president):

| Improvement | Hours/Week Saved | Annual Value (at $150/hr) |
|-------------|-----------------|--------------------------|
| Encircle crew data capture | 12 | $93,600 |
| Atlas claims tracking automation | 4 | $31,200 |
| Scope draft generation (Claude) | 6 | $46,800 |
| Content pipeline (n8n automated) | 4 | $31,200 |
| SEO monitoring (Otterly + MC) | 3 | $23,400 |
| Lead capture automation (Atlas) | 2 | $15,600 |
| **Total** | **31 hrs/week** | **$241,800/year** |

**Revenue impact:**
- Google LSA leads: 10-30 leads/mo x 30% close rate x $7,000 avg job = $21,000-63,000/mo new revenue
- SEO content empire (6-12 month payoff): estimated 20-40% organic traffic increase
- AI search visibility (first-mover advantage): unquantifiable but significant
- Automated review requests: 5-15 new reviews/mo compounds authority

**Net annual ROI:** Conservative estimate of $300,000-500,000 in time savings + new revenue against $15,000-28,000 in new tool costs.

---

## 14. Implementation Roadmap

### Week 1: Quick Wins (No New Tools Required)

| Task | Time | Tool |
|------|------|------|
| Start using XactScope in Xactimate | 2 hrs | Already have it |
| Add JSON-LD schema to flood.doctor + city sites | 4 hrs | Claude Code |
| Deploy Uptime Kuma on Mac mini | 1 hr | Docker |
| Build Atlas `/scope` command prototype | 4 hrs | Claude Code |
| Set up Atlas automated review request SMS | 2 hrs | Claude Code + Twilio |
| **Total** | **~13 hrs** | |

### Week 2: Core Infrastructure

| Task | Time | Tool |
|------|------|------|
| Sign up for Encircle, onboard 1 crew | 4 hrs | Encircle |
| Build claims tracker in Google Sheets + Atlas integration | 6 hrs | Claude Code |
| Implement Sonar API as Atlas tool | 2 hrs | Claude Code |
| Build automated adjuster follow-up emails | 4 hrs | Claude Code |
| Apply for Google Local Service Ads | 2 hrs | Google |
| **Total** | **~18 hrs** | |

### Week 3: Content Empire Foundation

| Task | Time | Tool |
|------|------|------|
| Register 3 blog domains | 1 hr | Namecheap |
| Set up WordPress hosting (Cloudways) | 2 hrs | Manual |
| Install and configure n8n on Mac mini | 3 hrs | Docker |
| Build first content pipeline (1 blog) | 4 hrs | Claude Code |
| Set up Otterly.ai with 13-city prompt list | 2 hrs | Otterly.ai |
| Sign up for RestorationAI supplement tool | 1 hr | RestorationAI |
| **Total** | **~13 hrs** | |

### Week 4: Mission Control Revival

| Task | Time | Tool |
|------|------|------|
| Implement SERP tracker service (replace stub) | 6 hrs | Claude Code |
| Fix GSC/GA4 token refresh | 2 hrs | Claude Code |
| Implement competitor intel service | 4 hrs | Claude Code |
| Connect Otterly.ai data to MC dashboard | 4 hrs | Claude Code |
| **Total** | **~16 hrs** | |

### Month 2: Scaling & Optimization

| Task | Time | Tool |
|------|------|------|
| Build Xactimate scope draft generator | 10 hrs | Claude Code |
| Expand content pipeline to 5 blogs | 8 hrs | Claude Code + n8n |
| Launch Google AI Max Search campaign | 6 hrs | Google Ads |
| Onboard all crews to Encircle | 8 hrs | Training |
| Build full document package automation | 8 hrs | Claude Code |
| Deploy chatbot on flood.doctor | 6 hrs | Poly Chat Bot or custom |
| **Total** | **~46 hrs** | |

### Month 3: Full Operation

| Task | Time | Tool |
|------|------|------|
| Voice-to-scope prototype for crews | 12 hrs | Claude Code + Whisper |
| Full Google Ads campaign expansion | 8 hrs | Google Ads |
| Content pipeline producing 50+ articles/month | Automated | n8n |
| All 13 cities with schema, fresh content, AI visibility | Ongoing | MC + Otterly |
| Claims tracker fully automated | Running | Atlas |
| **Total** | **~20 hrs + ongoing maintenance** | |

### The Priority Order (If You Can Only Do 3 Things)

1. **Deploy Encircle for crews** -- attacks your #1 pain point directly, saves the most time
2. **Build Atlas claims tracker + auto-follow-up** -- attacks your #2 pain point
3. **Add schema markup to all sites** -- quickest SEO win for AI visibility, takes 4 hours

Everything else amplifies these three foundations.

---

## Sources

### Perplexity Computer Reviews & Analysis
- [Builder.io: What It Gets Right and Wrong](https://www.builder.io/blog/perplexity-computer)
- [Boxmining: Perplexity Computer vs Claude Code Side-by-Side](https://www.boxmining.com/perplexity-computer-vs-claude-code/)
- [TechCrunch: Another Bet on Many AI Models](https://techcrunch.com/2026/02/27/perplexitys-new-computer-is-another-bet-that-users-need-many-ai-models/)
- [AIGyani: Full Review with Pricing & Pros/Cons](https://aigyani.com/perplexity-computer-review/)
- [Karol Zieminski: What I Built in One Night](https://karozieminski.substack.com/p/perplexity-computer-review-examples-guide)

### Perplexity Personal Computer
- [Macworld: Mac mini Running an AI OS](https://www.macworld.com/article/3086893/perplexitys-personal-computer-is-a-mac-mini-running-an-ai-os.html)
- [Digital Trends: What It Is, Does, and Costs](https://www.digitaltrends.com/computing/perplexitys-personal-computer-what-is-it-what-can-it-do-and-what-does-it-cost/)
- [9to5Mac: Cloud-based AI Agent on Mac mini](https://9to5mac.com/2026/03/11/perplexitys-personal-computer-is-a-cloud-based-ai-agent-running-on-mac-mini/)
- [Axios: Mac-Based AI Agent Launch](https://www.axios.com/2026/03/11/perplexity-personal-computer-mac)

### SEO & AI Search Visibility
- [SE Ranking: Perplexity Comet for SEO Review](https://seranking.com/blog/ai-powered-browser-perplexity-comet-for-seo/)
- [LLMrefs: GEO Guide 2026](https://llmrefs.com/generative-engine-optimization)
- [Yext: AI Visibility - How Gemini, ChatGPT, Perplexity Cite Brands](https://www.yext.com/blog/2025/10/ai-visibility-in-2025-how-gemini-chatgpt-perplexity-cite-brands)
- [Otterly.ai: AI Search Monitoring](https://otterly.ai/)
- [Rankability: Best AI Search Visibility Tools](https://www.rankability.com/blog/best-ai-search-visibility-tracking-tools/)
- [ALM Corp: Schema Markup Critical for SERP Visibility](https://almcorp.com/blog/schema-markup-detailed-guide-2026-serp-visibility/)

### Google Ads & Lead Generation
- [GoDuo: Google Ads for Water Damage Restoration](https://www.goduo.co/blog/google-ads-for-water-damage-restoration-companies-ppc-and-marketing-strategies)
- [ALM Corp: Water Damage CPC $250 Analysis](https://almcorp.com/blog/water-damage-restoration-cpc-costs-digital-marketing/)
- [Restoration Inbound: Google LSA for Restoration](https://restorationinbound.com/google-local-service-ads-for-restoration-leads/)
- [Google: AI Max for Search Campaigns](https://blog.google/products/ads-commerce/google-ai-max-for-search-campaigns/)

### Xactimate & Restoration Technology
- [Encircle: Field Documentation for Restoration](https://www.getencircle.com/restoration-contractor-estimators)
- [RestorationAI: Insurance Supplement Tool](https://www.restorationai.com/insurance-supplement-tool/)
- [Xactware Help: XactScope](https://xactware.helpdocs.io/l/enUS/article/3axb9l4a6e-about-xact-scope)
- [CompanyCam: API and Custom Integrations](https://help.companycam.com/en/articles/6828353-api-and-custom-integrations)

### Content Pipeline & Automation
- [n8n: Automate Blog Content with GPT-4 + Perplexity + WordPress](https://n8n.io/workflows/3336-automate-blog-content-creation-with-gpt-4-perplexity-and-wordpress/)
- [n8n: SEO Blog Content from Google Trends](https://n8n.io/workflows/8264-generate-seo-blog-posts-from-google-trends-to-wordpress-with-gpt-and-perplexity-ai/)
- [Google: AI Content Not Penalized if High Quality](https://maintouch.com/blogs/does-google-penalize-ai-generated-content)

### Insurance Claims & Legal
- [Virginia Code Title 43: Mechanics' Liens](https://law.lis.virginia.gov/vacodefull/title43/chapter1/)
- [Five Sigma: Clive AI Claims Expert](https://fivesigmalabs.com/clive/)
- [Assistimate: How to Supplement Xactimate Estimates](https://www.assistimate.com/how-to-supplement-xactimate-estimates/)
- [AI Lawyer: Demand Letter Templates](https://ailawyer.pro/blog/demand-letter-template-(free-download-ai-generator)-all-you-need-to-know)

### Perplexity API & Integration
- [Perplexity: Sonar API Pricing](https://docs.perplexity.ai/docs/getting-started/pricing)
- [Perplexity: Agent API](https://www.adwaitx.com/perplexity-agent-api-agentic-workflows/)
- [GitHub: Perplexity Sonar MCP Server](https://github.com/felores/perplexity-sonar-mcp)
- [Perplexity Help: How Credits Work](https://www.perplexity.ai/help-center/en/articles/13838041-how-credits-work-on-perplexity)

### Uptime Monitoring
- [Uptime Kuma: Self-Hosted Monitoring](https://uptimekuma.org/)
- [UptimeRobot: Free Monitoring](https://uptimerobot.com/)
