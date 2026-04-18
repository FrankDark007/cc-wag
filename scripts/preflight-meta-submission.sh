#!/bin/bash
# preflight-meta-submission.sh — Verify everything is green before Meta WhatsApp Sender submission
# Run this once immediately before following .planning/META-WHATSAPP-SUBMISSION.md

set -u

PROJECT_ROOT="/Users/ghost/Projects/cc-wag"
ENV_FILE="$PROJECT_ROOT/.env"
SMS_LOG="$PROJECT_ROOT/workspace/sms-inbox.log"
TUNNEL_HOST="atlas.vaserv.pro"

pass=0
fail=0

green()  { printf "\033[32m✓\033[0m %s\n" "$1"; pass=$((pass+1)); }
red()    { printf "\033[31m✗\033[0m %s\n" "$1"; fail=$((fail+1)); }
yellow() { printf "\033[33m!\033[0m %s\n" "$1"; }

echo "=== Meta WhatsApp Sender — Pre-flight Checks ==="
echo ""

# 1. .env exists with required vars
if [ ! -f "$ENV_FILE" ]; then
  red ".env missing at $ENV_FILE"
else
  required=(TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_WHATSAPP_NUMBER GATEWAY_API_TOKEN ANTHROPIC_API_KEY)
  missing=0
  for v in "${required[@]}"; do
    if ! grep -q "^${v}=" "$ENV_FILE" 2>/dev/null; then
      red ".env missing $v"
      missing=$((missing+1))
    fi
  done
  [ "$missing" -eq 0 ] && green ".env contains all required variables"
fi

# 2. Daemon is running
if launchctl list 2>/dev/null | grep -q com.flooddoctor.cc-wag; then
  green "launchd job com.flooddoctor.cc-wag is loaded"
else
  red "launchd job com.flooddoctor.cc-wag not loaded — run: launchctl load ~/Library/LaunchAgents/com.flooddoctor.cc-wag.plist"
fi

# 3. Gateway health check
if health=$(curl -sf http://localhost:4096/health 2>/dev/null); then
  if echo "$health" | grep -q '"status":"ok"'; then
    green "Gateway health: $health"
  else
    red "Gateway returned non-ok: $health"
  fi
else
  red "Gateway unreachable on http://localhost:4096/health"
fi

# 4. Tunnel reachable from public internet
if tunnel_health=$(curl -sf --max-time 8 "https://$TUNNEL_HOST/health" 2>/dev/null); then
  green "Public tunnel reachable: https://$TUNNEL_HOST/health"
else
  red "Public tunnel unreachable — check: launchctl list | grep atlas-tunnel"
fi

# 5. Twilio credentials valid
SID=$(grep '^TWILIO_ACCOUNT_SID=' "$ENV_FILE" 2>/dev/null | cut -d= -f2)
TOK=$(grep '^TWILIO_AUTH_TOKEN=' "$ENV_FILE" 2>/dev/null | cut -d= -f2)
if [ -n "$SID" ] && [ -n "$TOK" ]; then
  if twacct=$(curl -sf -u "$SID:$TOK" "https://api.twilio.com/2010-04-01/Accounts/$SID.json" 2>/dev/null); then
    name=$(echo "$twacct" | python3 -c "import sys,json; print(json.load(sys.stdin).get('friendly_name',''))" 2>/dev/null)
    green "Twilio auth works — account: $name"
  else
    red "Twilio credentials reject — rotate the auth token"
  fi
else
  red "Twilio credentials missing from .env"
fi

# 6. Twilio number owned
TARGET_NUMBER="+15715821100"
if numbers=$(curl -sf -u "$SID:$TOK" "https://api.twilio.com/2010-04-01/Accounts/$SID/IncomingPhoneNumbers.json" 2>/dev/null); then
  if echo "$numbers" | grep -q "$TARGET_NUMBER"; then
    green "Twilio owns $TARGET_NUMBER"
  else
    red "Twilio account does NOT own $TARGET_NUMBER — verify purchase"
  fi
fi

# 7. SMS webhook wired to the tunnel
if echo "$numbers" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for n in data.get('incoming_phone_numbers', []):
    if n.get('phone_number') == '$TARGET_NUMBER':
        sms_url = n.get('sms_url', '')
        if '$TUNNEL_HOST' in sms_url and '/webhook/twilio' in sms_url:
            sys.exit(0)
        else:
            print(sms_url)
            sys.exit(1)
sys.exit(2)
" 2>/dev/null; then
  green "SMS webhook on $TARGET_NUMBER points to tunnel (OTP capture ready)"
else
  red "SMS webhook on $TARGET_NUMBER is NOT pointing at https://$TUNNEL_HOST/webhook/twilio — Meta OTPs will be lost"
fi

# 8. WhatsApp Senders count (warn if any already exist)
if senders=$(curl -sf -u "$SID:$TOK" "https://messaging.twilio.com/v2/Channels/Senders?Channel=whatsapp" 2>/dev/null); then
  count=$(echo "$senders" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('senders',[])))" 2>/dev/null)
  if [ "$count" = "0" ]; then
    yellow "No WhatsApp Senders registered yet — proceed to submission"
  else
    yellow "$count WhatsApp Sender(s) already exist — check Twilio Console for status"
  fi
fi

# 9. SMS inbox log ready to tail
mkdir -p "$(dirname "$SMS_LOG")"
touch "$SMS_LOG"
green "SMS inbox log ready: $SMS_LOG"

# 10. Tests still pass
if (cd "$PROJECT_ROOT" && npm test --silent >/dev/null 2>&1); then
  green "All 39 vitest tests pass"
else
  red "vitest tests failing — run 'cd $PROJECT_ROOT && npm test' to diagnose"
fi

echo ""
echo "=== $pass passed, $fail failed ==="
echo ""
if [ "$fail" -eq 0 ]; then
  echo "READY. Open two terminals:"
  echo "  T1: tail -f $SMS_LOG"
  echo "  T2: open https://console.twilio.com/us1/develop/sms/senders/whatsapp-senders"
  echo ""
  echo "Follow: $PROJECT_ROOT/.planning/META-WHATSAPP-SUBMISSION.md"
  exit 0
else
  echo "NOT READY — fix the $fail red check(s) above before starting submission."
  exit 1
fi
