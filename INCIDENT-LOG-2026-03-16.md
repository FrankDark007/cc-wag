# Atlas Incident Log — 2026-03-16

## Session: Phases 7-10 Implementation + Critical Bug Fixes

### Overview
Implemented 18 new features (Phases 7-10), then spent significant time debugging why Atlas couldn't respond to messages. Found 3 cascading bugs that all had to be fixed before Atlas worked.

---

## Bug 1: WhatsApp "Bad MAC" Crash Loop (CRITICAL)

**Symptom:** Atlas goes offline at night and won't come back. Frank can't reach Atlas via WhatsApp.

**Root Cause:** WhatsApp uses Signal Protocol encryption. When the Mac mini sleeps/wakes, or WhatsApp servers rotate keys, the local session encryption state gets corrupted. The `libsignal` library throws `Bad MAC` errors as unhandled promise rejections. Node.js crashes on unhandled rejections. macOS `launchd` restarts Atlas (`KeepAlive: true`), but the corrupt auth state causes the same crash immediately. After ~10 rapid crashes, **macOS throttles the service** and stops restarting it for minutes at a time.

**Evidence:**
```
Session error:Error: Bad MAC Error: Bad MAC
    at Object.verifyMAC (libsignal/src/crypto.js:87:15)
    at SessionCipher.doDecryptWhisperMessage (libsignal/src/session_cipher.js:250:16)
```

**Fix (3 parts):**
1. `gateway.js` — Added `process.on('unhandledRejection')` and `process.on('uncaughtException')` handlers that catch Bad MAC errors instead of crashing. Baileys recovers on its own when keys are re-negotiated.
2. `gateway.js` — Added auto-recovery: tracks Bad MAC errors per contact, and after 5 errors within 1 minute, automatically deletes the corrupted `session-*.json` files in `auth_whatsapp/`. Baileys then re-negotiates fresh keys.
3. `com.flooddoctor.cc-wag.plist` — Added `ThrottleInterval: 5` to prevent macOS from aggressively throttling restarts.

**Commits:** `05e625c`, `6e91977`, `f5b1ebd`

---

## Bug 2: Intake Bot Intercepting Frank's Messages (CRITICAL)

**Symptom:** Frank texts "Atlas, are you online?" and gets "Hi! I'm Atlas, the assistant for Flood Doctor. What's your name?" — treated as a new customer lead. Every subsequent message is eaten by the intake flow.

**Root Cause:** The `intake-bot.js` feature intercepts messages from "unknown contacts" and starts a customer intake flow. It had a hardcoded `KNOWN_CHATS` set with only `17034981581@s.whatsapp.net`. But:
- Frank's self-chat arrives as LID `174796696477830@lid` (WhatsApp's new Linked ID format), not the phone JID
- Frank also texts from a second number `17033405356` which wasn't in the set
- The `sessionKey.includes('self:')` check was wrong — sessions use `:dm:` not `:self:`

Once the intake bot started a session for a chatId, it intercepted ALL subsequent messages (returning `handled: true` with no response), preventing them from reaching the Claude agent.

**Fix:**
1. Added Frank's LID and all `WHATSAPP_ALLOWED_DMS` numbers to `KNOWN_CHATS`
2. Changed the check to dynamically use the adapter's `lidToPhone` / `phoneToLid` maps for LID resolution
3. Added early exit: if `isSelfChat || isKnown || isKnownResolved`, skip intake entirely

**Commits:** `13ba4b1`, `00993b5`

---

## Bug 3: cron-parser v5 Breaking Import (CRITICAL — startup crash)

**Symptom:** Atlas crashes immediately on startup after Node.js upgrade.

**Root Cause:** `cron-parser` v5 changed its API. The old import `import { parseExpression } from 'cron-parser'` no longer exists. The new API is `import { CronExpressionParser } from 'cron-parser'` with `CronExpressionParser.parse()`.

**Evidence:**
```
SyntaxError: The requested module 'cron-parser' does not provide an export named 'parseExpression'
```

**Fix:** Updated import and usage in `src/tools/cron.js`.

**Commit:** `4f11aef`

---

## Bug 4: Agent SDK "Timed Out" (RESOLVED by fixing Bugs 1-3)

**Symptom:** Messages reach `[WHATSAPP] Processing...` but then `[Queue] Failed: Timed Out`.

**Root Cause:** Cascading effect of Bug 1. The Bad MAC errors corrupted WhatsApp's ability to send outbound messages. The Claude Agent SDK successfully generated a response, but `adapter.sendMessage()` failed with "Timed Out" because the WhatsApp socket couldn't encrypt outbound messages with corrupted session keys.

**Fix:** Deleting corrupted `session-*.json` files from `auth_whatsapp/` and restarting Atlas forced Baileys to re-negotiate fresh encryption keys. Combined with Bug 1's auto-recovery, this won't recur.

---

## Feature: /goaway Command (requested by Frank)

**Problem:** When Frank asks Atlas something in a team chat, Atlas keeps responding to everything else in that conversation.

**Fix:** Added `/goaway` (aliases: `/bye`, `/leave`) to `src/commands/handler.js`. Deactivates the self-chat or team session for that chatId. Atlas stops responding until re-activated with "Atlas," prefix.

**Commit:** `3a5bd2a`

---

## Timeline

| Time | Event |
|------|-------|
| ~2:00 PM | Atlas offline — Bad MAC crash loop from overnight |
| 2:30 PM | Diagnosed Bad MAC, added crash handlers + launchd throttle fix |
| 2:32 PM | Frank texts `/audit fix FD-006` — intake bot intercepts it |
| 2:49 PM | Frank texts "Hello Atlas" — intake bot eats it (no response) |
| 2:50 PM | "Atlas, what is your status?" — reaches agent but Timed Out |
| 3:00 PM | Identified intake-bot as message interceptor, added LID to known chats |
| 3:10 PM | cron-parser crash found — fixed import for v5 |
| 3:16 PM | Atlas online but intake bot STILL catches messages from 17033405356 |
| 3:18 PM | Frank gets "What's your name?" — intake bot treating him as customer |
| 3:19 PM | Fixed intake-bot to check full allowlist + adapter LID maps |
| 3:20 PM | Atlas fully operational, all features responding |

---

## Recommendations

1. **Monitor Bad MAC frequency** — if it happens daily, consider upgrading Baileys or pinning WhatsApp Web session
2. **Add all Frank's numbers to .env** — `WHATSAPP_ALLOWED_DMS` should include every number Frank uses
3. **Intake bot needs a smarter "unknown" check** — should check if the message came via self-chat mode (fromMe) rather than relying on a static known list
4. **Pin dependency versions** — `cron-parser` v5 broke the API. Use exact versions in package.json to prevent surprise breakage
