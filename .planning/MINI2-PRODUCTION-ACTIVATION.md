# Mini2 Production Activation Checklist

## Purpose

Final operator checklist to activate Atlas on mini2 (Mac Mini M4, user `ghost2`). Follow this after the runtime path migration is complete and all tests pass.

## Current known-good repo state

- **origin/main HEAD:** `8f1e655`
- **Tests:** 88/88 passing
- **Deployment target:** mini2 / Ghost2
- **Runtime paths:** machine-agnostic (derived from `import.meta.url`)
- **Model default:** `ATLAS_MODEL=claude-opus-4-7`
- **Twilio signature validation:** enabled when `TWILIO_WEBHOOK_URL` is set
- **Template support:** ready, awaiting Content SIDs after Meta approval

---

## 1. Pull latest code

```bash
cd /Users/ghost2/Projects/cc-wag
git fetch origin main
git status -sb
git pull --ff-only origin main
npm test
```

All tests must pass before proceeding.

## 2. Verify required files and directories

```bash
cd /Users/ghost2/Projects/cc-wag
for f in package.json src/gateway.js src/config.js .env.example; do
  [ -f "$f" ] && echo "OK: $f" || echo "MISSING: $f"
done
for d in workspace config/launchd scripts src/features; do
  [ -d "$d" ] && echo "OK: $d/" || echo "MISSING: $d/"
done
[ -f .env ] && echo "OK: .env exists" || echo "MISSING: .env — copy from .env.example and populate"
```

## 3. Verify .env presence without printing secrets

```bash
cd /Users/ghost2/Projects/cc-wag

# Required for Atlas to start
for v in ANTHROPIC_API_KEY ATLAS_MODEL WHATSAPP_ADAPTER GATEWAY_API_TOKEN; do
  count=$(grep -c "^${v}=" .env 2>/dev/null)
  echo "$v: ${count:-0} match(es)"
done

# Required for Twilio production WhatsApp
for v in TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_WHATSAPP_NUMBER TWILIO_WEBHOOK_URL; do
  count=$(grep -c "^${v}=" .env 2>/dev/null)
  echo "$v: ${count:-0} match(es)"
done

# Optional — needed when features are enabled
for v in COMPANYCAM_API_TOKEN TWILIO_TPL_ATLAS_STATUS_UPDATE TWILIO_TPL_ATLAS_ACTION_REQUIRED TWILIO_TPL_ATLAS_VERIFICATION_CODE; do
  count=$(grep -c "^${v}=" .env 2>/dev/null)
  echo "$v: ${count:-0} match(es) (optional)"
done
```

Every required var must show `1 match(es)`. Do not proceed if any required var is missing.

## 4. Recommended .env policy

- **`ATLAS_MODEL`** — set to `claude-opus-4-7` unless intentionally testing another model. This is the canonical Atlas model setting. `CLAUDE_MODEL` is supported as a fallback but `ATLAS_MODEL` takes precedence.
- **`ATLAS_PROJECT_ROOT`** — optional. Config derives repo root automatically from code location. Only set this if running from a non-standard path or testing.
- **`TWILIO_WEBHOOK_URL`** — must match the exact public URL configured in Twilio Console for signature validation. Production value: `https://atlas.vaserv.pro/webhook/twilio`
- **`TWILIO_TPL_*`** — leave empty until Twilio approves message templates and provides Content SIDs. Atlas falls back to plain `Body` text when templates are not configured.
- **`WHATSAPP_ADAPTER`** — set to `twilio` for production. `baileys` is legacy/sandbox only.

## 5. Launchd setup

The plist files in `config/launchd/` are **templates**. They contain placeholder paths (`/Users/ghost/Projects/cc-wag`) that must be replaced with the actual repo path before installing.

```bash
cd /Users/ghost2/Projects/cc-wag

# Create logs directory
mkdir -p logs

# Generate machine-specific plists (do not commit these)
REPO_PATH="/Users/ghost2/Projects/cc-wag"
for plist in config/launchd/*.plist; do
  base=$(basename "$plist")
  sed "s|/Users/ghost/Projects/cc-wag|$REPO_PATH|g; s|<string>/Users/ghost</string>|<string>/Users/ghost2</string>|g" \
    "$plist" > ~/Library/LaunchAgents/"$base"
  echo "Installed: ~/Library/LaunchAgents/$base"
done

# Verify generated files look correct (check paths, not secrets)
grep -n "ghost2" ~/Library/LaunchAgents/com.flooddoctor.*.plist

# Load the daemon
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.flooddoctor.cc-wag.plist

# Load the tunnel (if running tunnel from this machine)
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.flooddoctor.atlas-tunnel.plist
```

To check status:
```bash
launchctl list | grep flooddoctor
```

## 6. Cloudflare tunnel / public URL

- [ ] Confirm public URL resolves: `curl -s https://atlas.vaserv.pro/health`
- [ ] Confirm tunnel is running: `launchctl list | grep atlas-tunnel`
- [ ] Confirm route reaches mini2 (not the primary Mac)
- [ ] Do not expose `/api/send` without `GATEWAY_API_TOKEN` protection
- [ ] Webhook endpoint: `https://atlas.vaserv.pro/webhook/twilio`

If the tunnel was previously pointed at the primary Mac, update Cloudflare tunnel config to route to mini2's local IP or run `cloudflared` on mini2 directly.

## 7. Twilio console setup

After Meta WhatsApp Sender is approved and shows `ONLINE`:

- [ ] **Inbound webhook URL:** `https://atlas.vaserv.pro/webhook/twilio`
- [ ] **Method:** POST
- [ ] **Sender status:** ONLINE
- [ ] **Signature validation:** Atlas validates `X-Twilio-Signature` using `TWILIO_AUTH_TOKEN` when `TWILIO_WEBHOOK_URL` is set in `.env`

For message templates:
- [ ] Templates approved in Twilio Content Template Builder
- [ ] Content SIDs copied to `.env` as `TWILIO_TPL_ATLAS_STATUS_UPDATE`, etc.
- [ ] Proactive outbound (briefings, alerts) only works outside 24-hour window with approved templates

## 8. Smoke tests

```bash
# 1. Unit tests
npm test

# 2. Start daemon and check health
launchctl list | grep com.flooddoctor.cc-wag
curl -s http://localhost:4096/health | python3 -m json.tool

# 3. Public health (tunnel)
curl -s https://atlas.vaserv.pro/health | python3 -m json.tool

# 4. Tail logs during test
tail -f logs/gateway.log
```

Once WhatsApp is live:
- [ ] Send `Atlas, are you online?` from personal WhatsApp to `+15715821100`
- [ ] Confirm reply arrives within 15 seconds
- [ ] Check `logs/gateway.log` shows inbound + outbound with no unmasked secrets
- [ ] Verify invalid signature is rejected (send a raw POST without valid X-Twilio-Signature — should get 403)

Template test (only after Content SIDs exist):
- [ ] Wait >24 hours after last inbound from test number
- [ ] Trigger a proactive cron job (e.g. morning briefing)
- [ ] Confirm template-based delivery succeeds

## 9. Failure rollback

If something goes wrong:

```bash
# Stop the daemon
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.flooddoctor.cc-wag.plist

# Check what happened
tail -50 logs/gateway-error.log
```

- Do **not** use `git reset --hard` without Frank's explicit approval
- To revert a commit: `git revert HEAD` (creates a new commit, preserves history)
- To temporarily run an older version: `git stash && git checkout <hash> -- src/` then restart daemon

## 10. What not to do

- Do not print `.env` contents (`cat .env`, `grep -h .env`, or reading with tools)
- Do not commit `.env` or any file containing credentials
- Do not hardcode `/Users/ghost2` in runtime code or scripts
- Do not disable Twilio signature validation in production (removing `TWILIO_WEBHOOK_URL`)
- Do not set `ATLAS_MODEL` back to Sonnet unless intentionally testing cost optimization
- Do not use `--force` push or `git reset --hard` without explicit approval
- Do not modify `config/launchd/*.plist` templates with machine-specific paths — generate locally instead
