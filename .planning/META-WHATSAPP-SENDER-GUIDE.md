# Meta / Twilio WhatsApp Sender Registration Guide

## Purpose

This guide walks Frank through the manual browser steps required to register a WhatsApp Business Sender via Twilio. Completing this unblocks production WhatsApp for Project Atlas. No AI agent can perform these steps because they require Facebook OAuth, 2FA, and potentially LLC document uploads.

## Current blocker

- Twilio WhatsApp Senders array is **empty** — no sender has been registered
- Meta WhatsApp Business Sender registration requires a Facebook login with admin access to the Flood Doctor business portfolio
- Claude cannot complete OAuth, 2FA, business verification, or upload LLC documents
- Frank must perform the browser steps manually
- Once the sender is ONLINE, Claude can wire the webhook, submit templates, and verify end-to-end

## Required accounts and access

Before starting, confirm you have:

- [ ] **Twilio Console access** — https://console.twilio.com
- [ ] **Facebook account** with admin access to the Flood Doctor Facebook Business Page
- [ ] **Meta Business Manager** at https://business.facebook.com (or ready to create one)
- [ ] **Flood Doctor LLC legal documents** — Virginia SCC Certificate of Organization, plus one of: utility bill, bank statement, or business license in the LLC name
- [ ] **Phone number for WhatsApp sender** — `+15715821100` (already purchased on Twilio)
- [ ] **Ability to receive OTP** on that number — SMS webhook already routes to `workspace/sms-inbox.log`
- [ ] **Business website** — `https://flood.doctor`
- [ ] **Business address** — `8466D Tyco Rd, Vienna, VA 22182`

## Phone number warning

- The WhatsApp sender number (`+15715821100`) must **not** already be registered with WhatsApp on a personal device. If it is, you must delete WhatsApp from that device first, or Meta will reject the registration.
- The number must be able to receive SMS or voice OTP. Atlas already captures SMS via the Twilio webhook.
- IVR or auto-attendant systems can block OTP delivery. The Twilio number routes SMS to a log file and voice to a voicemail twimlet — both work.
- **Do not start registration until you have confirmed the number can receive a verification code.** Test by sending yourself an SMS via Twilio Console first.

---

## Step 1 — Twilio Console: Start sender registration

1. Open https://console.twilio.com
2. Navigate to **Messaging > Senders > WhatsApp senders**
3. Click **Create new Sender**
4. Choose **Register a number with WhatsApp** (not "Use a number from my own Meta account")
5. Select phone number `+15715821100` from the dropdown
6. Click **Continue with Facebook** — a Meta popup opens

Do not close the Twilio tab. The popup must complete and return to Twilio.

## Step 2 — Meta popup: Facebook login and WABA creation

In the Meta popup, you will be prompted in this order:

1. **Log into Facebook** — use the personal account that admins the Flood Doctor Facebook Page
2. **Select or create Meta Business Portfolio** — pick the existing Flood Doctor portfolio, or create one named `Flood Doctor LLC`
3. **Create WhatsApp Business Account (WABA)** — name it `Flood Doctor LLC`
4. **Business display name** — enter `Flood Doctor`
   - Must match the legal/trade name. No generic terms, no all-caps, no emojis
   - Fallback if rejected: `Flood Doctor LLC` or `Flood Doctor VA`
5. **Business category** — `Professional Services` or `Cleaning Services`
6. **Business description** — paste:
   > Water damage restoration, mold remediation, and emergency flood cleanup serving Northern Virginia, DC, and Maryland. IICRC-certified. 24/7 emergency response.
7. **Business website** — `https://flood.doctor`
8. **Business address** — `8466D Tyco Rd, Vienna, VA 22182`
9. **Phone number verification** — `+15715821100`, choose **SMS** delivery
10. **Enter the OTP** — read it from the SMS log (see below), type it into the Meta popup, click Verify

### Reading the OTP

Open a terminal on the production machine:
```bash
tail -f /Users/ghost/Projects/cc-wag/workspace/sms-inbox.log
```

When Meta sends the 6-digit code, it appears here within seconds. Type it into the Meta popup.

If SMS does not arrive within 60 seconds, click **Call me instead** in the Meta popup. Twilio routes the call to a voicemail twimlet. Retrieve the recording from: Twilio Console > Monitor > Logs > Calls > click latest > listen.

**Do not abandon the Meta popup midway.** If you close it before completing, Twilio may be left waiting for a callback and you'll need to restart from Step 1.

## Step 3 — Twilio sender result

After the Meta popup closes:

1. Return to the Twilio Console tab
2. The sender should appear in **WhatsApp Senders** with a status:
   - `ONLINE` — approved, proceed to Step 4
   - `PENDING` / `REGISTRATION_PENDING` — Meta is reviewing, check back in hours to days
   - `VERIFICATION_REQUIRED` — Meta needs business documents (see Step 3a below)
   - `REJECTED` — capture the reason, see Troubleshooting section
3. Note the **sender phone number** and **status** (do not copy credentials into chat)

### Step 3a — Business verification (only if required)

1. Go to https://business.facebook.com > Settings > Security Center > Start Verification
2. Upload documents in this order of preference:
   - Virginia SCC Certificate of Organization (most reliable)
   - Utility bill showing `Flood Doctor LLC` at `8466D Tyco Rd`
   - Bank statement showing `Flood Doctor LLC`
3. Confirm contact method — pick email, use `frank@flood.doctor`
4. Submit and wait 1-3 business days. Meta sends a Facebook notification and email on approval.

## Step 4 — Message templates

Proactive outbound messages (Atlas initiating, not replying within a 24-hour window) require pre-approved templates. Submit these three via Twilio Console > Messaging > Content Template Builder:

### atlas_verification_code

- **Category:** UTILITY
- **Language:** en_US
- **Purpose:** Send verification codes to Frank for secure operations
- **Body:**
  ```
  Your Atlas verification code is {{1}}. This code expires in {{2}} minutes. Do not share this code with anyone.
  ```
- **Variables:** `{{1}}` = code, `{{2}}` = expiry minutes
- **Approval note:** Authentication/verification templates have the highest approval rate

### atlas_status_update

- **Category:** UTILITY
- **Language:** en_US
- **Purpose:** Send status updates for jobs, briefings, alerts, and system notifications
- **Body:**
  ```
  Atlas update: {{1}}. Reply here if you need help or want to change this request.
  ```
- **Variables:** `{{1}}` = update content (briefing summary, job status, alert text)
- **Approval note:** Keep variable content factual and non-promotional

### atlas_action_required

- **Category:** UTILITY
- **Language:** en_US
- **Purpose:** Request Frank's review or approval on pending items
- **Body:**
  ```
  Atlas needs your review: {{1}}. Please reply with approval, changes, or any questions.
  ```
- **Variables:** `{{1}}` = item requiring review
- **Approval note:** Action-required templates are standard UTILITY use case

**Important:** Always submit as UTILITY, never MARKETING. UTILITY templates are reviewed in hours; MARKETING triggers stricter review and higher per-message costs.

## Step 5 — Information needed by developer after approval

Once the sender is ONLINE and templates are approved, provide Claude with:

- Sender phone number (already known: `+15715821100`)
- Twilio Sender SID (visible in Twilio Console, starts with `XE`)
- Sender status (`ONLINE`)
- Messaging Service SID if one was created (starts with `MG`)
- Template approval statuses (approved / pending / rejected per template)
- Whether the inbound webhook field in Twilio Console is set to `https://atlas.vaserv.pro/webhook/twilio`

**Do not paste credentials, auth tokens, or API keys into chat.** Claude will read them from `.env` on the production machine using safe methods only.

## Step 6 — End-to-end test checklist

After webhook is wired:

- [ ] Send `Atlas, are you online?` from personal WhatsApp to `+15715821100`
- [ ] Confirm Atlas receives the webhook (check `logs/gateway.log`)
- [ ] Confirm Atlas sends a reply back through Twilio
- [ ] Test an approved template outside the 24-hour customer-service window
- [ ] Verify `logs/gateway.log` contains no unmasked secrets (credential masking is active)

Watch logs during the test:
```bash
tail -f /Users/ghost/Projects/cc-wag/logs/gateway.log
```

Expected: `[WHATSAPP] Incoming message:` > `[Agent] Using tool:` > `[Queue] Completed` > reply in WhatsApp within ~10-15 seconds.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| **OTP not received via SMS** | Wait 60s, then click "Call me instead" in Meta popup. Check voicemail in Twilio Console > Monitor > Logs > Calls. Confirm SMS webhook points to `https://atlas.vaserv.pro/webhook/twilio`. |
| **Display name rejected** | Change to exact legal name: `Flood Doctor LLC`. If still rejected, try `VA Water Damage LLC` (the Virginia SCC entity name). |
| **Business verification pending** | Normal — takes 1-3 business days. Do not resubmit. Check status at Meta Business Suite > Settings > Security Center. |
| **Sender stuck in PENDING** | Wait 24 hours. If still pending, check Meta Business Suite for any action items or document requests. Contact Twilio Support if >48 hours. |
| **Template rejected** | Rewrite with more specific, non-promotional language. Ensure category is UTILITY not MARKETING. Remove any discount/offer/CTA language. |
| **Webhook receives nothing** | Confirm Twilio inbound webhook is set to `https://atlas.vaserv.pro/webhook/twilio`. Confirm tunnel is up: `curl -s https://atlas.vaserv.pro/health`. Confirm daemon is running: `launchctl list \| grep flooddoctor`. |
| **Sandbox works but production does not** | Sender must show `ONLINE` status. Sandbox and production use different Twilio credentials. Confirm `WHATSAPP_ADAPTER=twilio` in `.env`. |
| **Phone number already registered** | The number is tied to another WhatsApp account. Delete WhatsApp from that device, or use Meta's number migration flow in Meta Business Suite > WhatsApp Accounts > Migrate Number. |

## What Claude can and cannot do

### Can do
- Prepare documentation and guides (this file)
- Inspect code, run tests, verify architecture
- Wire the Twilio inbound webhook after sender values are available
- Draft and refine message templates
- Verify logs contain no unmasked secrets
- Monitor sender status if asked
- Run preflight checks: `bash scripts/preflight-meta-submission.sh`

### Cannot do
- Log into Facebook or Meta Business Suite
- Complete OAuth or 2FA flows
- Upload LLC documents to Meta
- Wait in Meta's human review queue
- See or handle credentials unless they exist in `.env` on the production machine (and even then, only via safe `grep -c` / `grep -l` checks)
