# Meta WhatsApp Sender Submission — Executable Playbook

**Target:** Move Atlas off the Twilio WhatsApp sandbox onto a production WhatsApp Business Sender registered to Flood Doctor LLC with number **+1 571-582-1100**.

**Current state (verified 2026-04-18):**
- Twilio number `+15715821100` purchased with friendly name "Atlas - Flood Doctor" — ✅
- SMS/Voice webhooks already point at `https://atlas.vaserv.pro/webhook/twilio` (SMS) and a twimlets voicemail reader (voice) — ✅ ready to capture Meta's OTP
- Twilio WhatsApp Senders: **zero registered** — the submission has not been started
- Twilio adapter in the gateway is already coded and wired — `src/adapters/twilio-whatsapp.js`, selected via `WHATSAPP_ADAPTER=twilio`

The **only** work that remains is the human-in-the-loop Meta/Facebook side. The software waits on you.

---

## Pick your path

Twilio supports two onboarding flows. **Use path A.** Path B is here only if A is unavailable for your account.

| Path | Time | Facebook login required | Success rate |
|------|------|-------------------------|--------------|
| **A. Twilio Embedded Signup** (recommended) | 15–60 min same day | Yes, inline | ~95% |
| B. Manual submission | 3–14 days | Yes, separate | ~70% (frequent rejection) |

---

## Path A — Twilio Embedded Signup (do this)

### Prerequisites (gather before you start)

Have all of this open in one tab each so you don't have to stop:

1. **Facebook login** — the personal account that administers Flood Doctor's Facebook Business Page
2. **Meta Business Manager** at https://business.facebook.com — account ID handy
3. **Business verification docs** — any two of: LLC Certificate of Organization (Virginia SCC), business license, utility bill in LLC name, bank statement in LLC name, articles of incorporation
4. **Business phone** — a number the business answers during business hours (your mobile is fine)
5. **Business email** at the business domain — `frank@flood.doctor` ideally, not gmail
6. **Business website** — `https://flood.doctor`
7. **The Twilio number** — `+15715821100` (already purchased)
8. **Display name decision** — what shows to recipients. Pre-approved candidates in rank order:
   - `Flood Doctor` (preferred — exact LLC trade name, 12 chars)
   - `Flood Doctor VA`
   - `Flood Doctor LLC`

### Step 1. Start the Embedded Signup in Twilio Console

1. Go to https://console.twilio.com → Messaging → Senders → WhatsApp senders
2. Click **Create new Sender**
3. Choose **Register a number with WhatsApp** (NOT "Use a number from my own Meta account")
4. Select phone number `+15715821100` from the dropdown (it's already in your account)
5. Click **Continue with Facebook** — this opens a Meta popup

### Step 2. Meta popup — WhatsApp Business Account creation

You'll be asked, in order:

1. **Log into Facebook** — use the account that owns/admins the Flood Doctor Page
2. **Select Meta Business Account** — pick the Flood Doctor business portfolio. If none exists, create one named `Flood Doctor LLC`
3. **Create WhatsApp Business Account (WABA)** — name it `Flood Doctor LLC`
4. **Business display name** — enter `Flood Doctor`
   - Rules: no generic terms, no all-caps, no emojis, must match legal/trade name or DBA
5. **Business category** — pick `Professional Services` or `Cleaning Services`
6. **Business description** — paste:
   > Water damage restoration, mold remediation, and emergency flood cleanup serving Northern Virginia, DC, and Maryland. IICRC-certified. 24/7 emergency response.
7. **Business website** — `https://flood.doctor`
8. **Business address** — `8466D Tyco Rd, Vienna, VA 22182` (matches your Google Business Profile)
9. **Phone number for verification** — `+15715821100` (the Twilio number — Meta sends OTP here)
10. **OTP delivery method** — choose **SMS** (voice fallback is already wired as backup)

### Step 3. Receive and enter the OTP

This is where you were previously blocked. Here's the fix — Atlas captures it for you:

**SMS path (primary):**
- Meta sends a 6-digit code via SMS to `+15715821100`
- Twilio routes it to webhook `https://atlas.vaserv.pro/webhook/twilio`
- Gateway fallback handler writes it to `/Users/ghost/Projects/cc-wag/workspace/sms-inbox.log`
- Watch for it with: `tail -f /Users/ghost/Projects/cc-wag/workspace/sms-inbox.log`

**Voice path (if SMS delayed >60s):**
- In the Meta popup click **Call me instead**
- Twilio routes incoming voice to `http://twimlets.com/voicemail?Email=&Message=Please+leave+your+verification+code`
- The twimlet answers, records the code as a voicemail
- Retrieve: Twilio Console → Monitor → Logs → Calls → click latest → listen to recording

Type the code into the Meta popup. Click **Verify**.

### Step 4. Submit for Meta review

The Meta popup closes. Twilio shows the Sender status as `CREATING` → `PENDING` → one of:

- `ONLINE` (instant approval, possible for low-risk verticals)
- `REGISTRATION_PENDING` (Meta review — hours to days)
- `VERIFICATION_REQUIRED` (business docs needed — go to Step 5)

### Step 5. Business Verification (only if required)

If Meta asks for business verification:

1. Meta Business Suite → Settings → Security Center → Start Verification
2. Upload documents in this order of preference:
   - Virginia SCC Certificate of Organization (most reliable)
   - Utility bill showing `Flood Doctor LLC` + `8466D Tyco Rd`
   - Bank statement showing `Flood Doctor LLC`
3. Confirm phone or email — pick email, use `frank@flood.doctor`
4. Submit

Meta reviews in 1–3 business days. You'll get a Facebook notification and an email when approved.

### Step 6. Post-approval — point Twilio at the gateway webhook

Once Twilio Console shows the Sender as `ONLINE`:

1. Twilio Console → Messaging → Senders → WhatsApp senders → click the new Sender
2. **Inbound messages webhook** — set to `https://atlas.vaserv.pro/webhook/twilio`
3. **Status callback** — leave blank or same URL
4. Save

### Step 7. Verify end-to-end

From your WhatsApp, send to `+1 571-582-1100`:
```
Atlas, are you online?
```

Expected flow (watch the logs):
```bash
tail -f /Users/ghost/Projects/cc-wag/logs/gateway.log
```
Should see: `[WHATSAPP] Incoming message:` → `[Agent] Using tool: Skill` → `[Queue] Completed` → reply arrives in your WhatsApp within ~10 s.

If timeout: re-check the webhook URL, and check `launchctl list | grep flooddoctor` shows `com.flooddoctor.cc-wag` is running.

---

## Path B — Manual submission (fallback only)

Use only if Embedded Signup fails. Path A handles 95% of cases.

1. Create Meta Business Account manually at https://business.facebook.com → Settings → Accounts → WhatsApp Accounts → Add
2. Create WABA manually, enter all business details (same as Path A Step 2)
3. In Twilio Console → Senders → WhatsApp → Create → **Use a number from my own Meta account**
4. Provide: WABA ID, phone number, phone number ID (all from Meta Business Suite)
5. Twilio runs verification separately — same OTP flow as Path A Step 3
6. Continue from Path A Step 5

---

## Message Template submission (after Sender is ONLINE)

Proactive outbound (Atlas initiating, not replying) requires pre-approved templates. Reactive within 24 h of user's last message does NOT require a template.

Submit these three templates first — they cover 90% of Atlas's outbound use cases:

### 1. Daily briefing (transactional, UTILITY category)

```
Name: atlas_daily_briefing
Category: UTILITY
Language: en_US
Body:
Good morning, {{1}}. Today's briefing:
• Weather: {{2}}
• Open jobs: {{3}}
• Due today: {{4}}
• Overdue: {{5}}
Reply "Atlas," followed by your question for details.
```

### 2. Lead alert (transactional, UTILITY)

```
Name: atlas_new_lead_alert
Category: UTILITY
Language: en_US
Body:
New lead received from {{1}}.
Name: {{2}}
Phone: {{3}}
Address: {{4}}
Call back ASAP to confirm service.
```

### 3. Adjuster follow-up nag (transactional, UTILITY)

```
Name: atlas_adjuster_followup_reminder
Category: UTILITY
Language: en_US
Body:
Adjuster follow-up due: claim {{1}} for {{2}}. Last contact was {{3}} days ago. Reply "Atlas, draft follow-up for {{1}}" to generate the email.
```

Submit via Twilio Console → Messaging → Content Template Builder. Meta reviews each in 1–24 hours.

Do NOT mark these as MARKETING — that triggers stricter review and per-message user-initiated conversation costs. UTILITY is correct for internal ops notifications.

---

## If Meta rejects

Most common rejection reasons and remedies:

| Reason | Remedy |
|--------|--------|
| "Display name doesn't match business" | Change to exact legal name on SCC filing: `Flood Doctor LLC` (add LLC suffix) |
| "Business not verified" | Complete Path A Step 5 before resubmitting |
| "Phone already associated with another WABA" | Migrate from old WABA: Meta Business Suite → WhatsApp Accounts → Migrate Number |
| "Template violates policy" | UTILITY/AUTHENTICATION templates rarely reject; MARKETING often does. Rewrite as UTILITY with transactional wording |

---

## Readiness checklist — tick before you start Path A

- [ ] Facebook login works and you have admin on Flood Doctor's FB Page
- [ ] Meta Business Manager exists (or you're ready to create one)
- [ ] LLC Certificate of Organization PDF saved locally
- [ ] Utility bill or bank statement in LLC name saved locally
- [ ] `tail -f /Users/ghost/Projects/cc-wag/workspace/sms-inbox.log` open in a terminal to watch for OTP
- [ ] Gateway is up: `curl -s http://localhost:4096/health` returns `"connected":true`
- [ ] Tunnel is up: `curl -s https://atlas.vaserv.pro/health` returns the same JSON
- [ ] Display name decision: `Flood Doctor` (primary), `Flood Doctor LLC` (fallback)

When every box is ticked, Path A end-to-end takes 15–60 min of real attention.

---

## What Atlas can and cannot do here

**Atlas (me) cannot:**
- Log into your Facebook account (2FA, not delegatable)
- Upload your LLC documents to Meta Business Suite (requires your session)
- Sit in Meta's human review queue

**Atlas (me) can — and already has:**
- Route incoming SMS OTPs from `+15715821100` to a log file you can tail
- Route incoming voice calls to a voicemail that reads codes back
- Verify gateway and tunnel health at submission time
- Submit message templates via Twilio API once you hand me a template SID and your WABA ID
- Monitor Sender status every 60 s and WhatsApp you on state change (say the word and I'll wire that up)

---

## One-command pre-flight

```bash
bash /Users/ghost/Projects/cc-wag/scripts/preflight-meta-submission.sh
```

This script (to be added) runs every readiness check and reports PASS/FAIL. Say the word and I'll write it.
