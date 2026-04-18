#!/bin/bash

set -euo pipefail

# Paths
WORKSPACE="/Users/ghost/Projects/cc-wag/workspace/task-queue"
SIGNPOST_LAST_ID="$WORKSPACE/signpost-last-id.txt"
SERVICE_LAST_ID="$WORKSPACE/service-request-last-id.txt"
ESCALATION_STATE="$WORKSPACE/escalation-state.json"
LOG_FILE="$WORKSPACE/lead-watcher.log"
GATEWAY_URL="${GATEWAY_URL:-http://localhost:4096/api/send}"
GATEWAY_TOKEN="${GATEWAY_API_TOKEN:-$(grep '^GATEWAY_API_TOKEN=' /Users/ghost/Projects/cc-wag/.env 2>/dev/null | cut -d= -f2)}"
FRANK_CHAT_ID="17034981581@s.whatsapp.net"
DAVE_CHAT_ID="12024598844@s.whatsapp.net"

# Ensure workspace directory exists
mkdir -p "$WORKSPACE"

# Initialize state files if they don't exist
touch "$SIGNPOST_LAST_ID"
touch "$SERVICE_LAST_ID"
[ -f "$ESCALATION_STATE" ] || echo '{}' > "$ESCALATION_STATE"

# Log function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
}

# Send WhatsApp message
send_whatsapp() {
    local chat_id="$1"
    local message="$2"
    curl -s -X POST "$GATEWAY_URL" \
        -H 'Content-Type: application/json' \
        -H "Authorization: Bearer $GATEWAY_TOKEN" \
        -d "{\"chat_id\":\"$chat_id\",\"message\":$(printf '%s' "$message" | python3 -c 'import sys, json; print(json.dumps(sys.stdin.read()))')}" \
        >> "$LOG_FILE" 2>&1
}

# Add escalation entry
add_escalation() {
    local alert_id="$1"
    local alert_type="$2"
    local timestamp="$(date +%s)"

    python3 -c "
import json
import sys

try:
    with open('$ESCALATION_STATE', 'r') as f:
        state = json.load(f)
except:
    state = {}

state['$alert_id'] = {
    'type': '$alert_type',
    'timestamp': $timestamp,
    'alerted_frank': True,
    'alerted_dave': False
}

with open('$ESCALATION_STATE', 'w') as f:
    json.dump(state, f, indent=2)
"
}

# Check and escalate pending alerts
check_escalations() {
    local current_time="$(date +%s)"

    python3 -c "
import json
import sys

try:
    with open('$ESCALATION_STATE', 'r') as f:
        state = json.load(f)
except:
    state = {}

escalate_list = []
current_time = $current_time

for alert_id, data in list(state.items()):
    # If more than 5 minutes old and Dave hasn't been alerted
    if not data.get('alerted_dave', False) and (current_time - data['timestamp']) >= 300:
        escalate_list.append((alert_id, data['type']))

for alert_id, alert_type in escalate_list:
    print(f'{alert_id}|{alert_type}')
" | while IFS='|' read -r alert_id alert_type; do
        if [ -n "$alert_id" ]; then
            log "ESCALATION: $alert_type alert $alert_id - notifying Dave"
            send_whatsapp "$DAVE_CHAT_ID" "⚠️ ESCALATION: $alert_type lead needs attention (ID: $alert_id). Frank was alerted 5+ minutes ago."

            # Mark as escalated to Dave
            python3 -c "
import json
with open('$ESCALATION_STATE', 'r') as f:
    state = json.load(f)
state['$alert_id']['alerted_dave'] = True
with open('$ESCALATION_STATE', 'w') as f:
    json.dump(state, f, indent=2)
"
        fi
    done
}

# Remove old escalations (>24 hours)
cleanup_escalations() {
    local current_time="$(date +%s)"

    python3 -c "
import json

try:
    with open('$ESCALATION_STATE', 'r') as f:
        state = json.load(f)
except:
    state = {}

current_time = $current_time

# Remove entries older than 24 hours
state = {k: v for k, v in state.items() if (current_time - v['timestamp']) < 86400}

with open('$ESCALATION_STATE', 'w') as f:
    json.dump(state, f, indent=2)
"
}

# A) SIGNPOST CALLS
process_signpost_calls() {
    log "Checking Signpost calls..."

    local last_id=""
    [ -f "$SIGNPOST_LAST_ID" ] && last_id=$(cat "$SIGNPOST_LAST_ID")

    local messages
    messages=$(gws gmail users messages list --params '{"userId":"me","q":"from:no-reply@signpost.com is:unread","maxResults":5}' 2>/dev/null || echo '{}')

    local message_ids
    message_ids=$(echo "$messages" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    messages = data.get('messages', [])
    for msg in messages:
        print(msg['id'])
except:
    pass
" || true)

    if [ -z "$message_ids" ]; then
        log "No new Signpost calls"
        return
    fi

    local found_last=false
    local new_ids=()

    while IFS= read -r msg_id; do
        [ -z "$msg_id" ] && continue

        if [ "$msg_id" = "$last_id" ]; then
            found_last=true
            break
        fi
        new_ids+=("$msg_id")
    done <<< "$message_ids"

    # Process new messages in reverse order (oldest first)
    for ((i=${#new_ids[@]}-1; i>=0; i--)); do
        local msg_id="${new_ids[$i]}"
        log "Processing Signpost call: $msg_id"

        local message_data
        message_data=$(gws gmail users messages get --params "{\"userId\":\"me\",\"id\":\"$msg_id\"}" 2>/dev/null || echo '{}')

        local snippet
        snippet=$(echo "$message_data" | python3 -c "
import json, sys, re
try:
    data = json.load(sys.stdin)
    snippet = data.get('snippet', '')

    # Extract caller name and phone from snippet
    # Example: 'Signpost missed call from John Doe at 555-1234'
    caller_name = 'Unknown'
    caller_phone = 'Unknown'

    # Try to extract name and phone
    match = re.search(r'from[:\s]+([^at]+?)(?:\s+at|\s+\(|\s+-|\s+\d)', snippet)
    if match:
        caller_name = match.group(1).strip()

    match = re.search(r'(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})', snippet)
    if match:
        caller_phone = match.group(1)

    print(f'{caller_name}|{caller_phone}|{snippet[:200]}')
except Exception as e:
    print(f'Unknown|Unknown|Error: {e}')
")

        IFS='|' read -r caller_name caller_phone snippet_text <<< "$snippet"

        local alert_msg="📞 NEW SIGNPOST CALL

Caller: $caller_name
Phone: $caller_phone

Details: $snippet_text

Message ID: $msg_id"

        log "Sending alert for Signpost call from $caller_name ($caller_phone)"
        send_whatsapp "$FRANK_CHAT_ID" "$alert_msg"

        # Add to escalation tracking
        add_escalation "signpost-$msg_id" "Signpost Call"
    done

    # Update last processed ID
    if [ ${#new_ids[@]} -gt 0 ]; then
        echo "${new_ids[0]}" > "$SIGNPOST_LAST_ID"
        log "Updated last Signpost ID: ${new_ids[0]}"
    fi
}

# B) SERVICE REQUESTS
process_service_requests() {
    log "Checking service requests..."

    local last_id=""
    [ -f "$SERVICE_LAST_ID" ] && last_id=$(cat "$SERVICE_LAST_ID")

    local messages
    messages=$(gws gmail users messages list --params '{"userId":"me","q":"from:NOREPLY@flooddoctorva.com subject:service request is:unread","maxResults":5}' 2>/dev/null || echo '{}')

    local message_ids
    message_ids=$(echo "$messages" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    messages = data.get('messages', [])
    for msg in messages:
        print(msg['id'])
except:
    pass
" || true)

    if [ -z "$message_ids" ]; then
        log "No new service requests"
        return
    fi

    local found_last=false
    local new_ids=()

    while IFS= read -r msg_id; do
        [ -z "$msg_id" ] && continue

        if [ "$msg_id" = "$last_id" ]; then
            found_last=true
            break
        fi
        new_ids+=("$msg_id")
    done <<< "$message_ids"

    # Process new messages in reverse order (oldest first)
    for ((i=${#new_ids[@]}-1; i>=0; i--)); do
        local msg_id="${new_ids[$i]}"
        log "Processing service request: $msg_id"

        local message_data
        message_data=$(gws gmail users messages get --params "{\"userId\":\"me\",\"id\":\"$msg_id\",\"format\":\"full\"}" 2>/dev/null || echo '{}')

        # Extract client info from HTML body
        local client_info
        client_info=$(echo "$message_data" | python3 -c "
import json, sys, re, base64

try:
    data = json.load(sys.stdin)

    # Get email body
    body = ''
    payload = data.get('payload', {})

    # Try to find HTML part
    if 'parts' in payload:
        for part in payload['parts']:
            if part.get('mimeType') == 'text/html':
                body = base64.urlsafe_b64decode(part['body']['data'] + '===').decode('utf-8', errors='ignore')
                break
    elif payload.get('body', {}).get('data'):
        body = base64.urlsafe_b64decode(payload['body']['data'] + '===').decode('utf-8', errors='ignore')

    # Extract info using regex
    name = 'Unknown'
    email = ''
    phone = 'Unknown'
    address = 'Unknown'

    name_match = re.search(r'Name[:\s]+([^\n<]+)', body, re.IGNORECASE)
    if name_match:
        name = name_match.group(1).strip()

    email_match = re.search(r'Email[:\s]+([^\s<]+@[^\s<]+)', body, re.IGNORECASE)
    if email_match:
        email = email_match.group(1).strip()

    phone_match = re.search(r'Phone[:\s]+([0-9\-\(\)\s\.]+)', body, re.IGNORECASE)
    if phone_match:
        phone = phone_match.group(1).strip()

    address_match = re.search(r'(?:Address|Location)[:\s]+([^\n<]+)', body, re.IGNORECASE)
    if address_match:
        address = address_match.group(1).strip()

    print(f'{name}|{email}|{phone}|{address}')
except Exception as e:
    print(f'Unknown||Unknown|Unknown')
    sys.stderr.write(f'Error: {e}\n')
")

        IFS='|' read -r client_name client_email client_phone client_address <<< "$client_info"

        local alert_msg="🚨 NEW SERVICE REQUEST

Client: $client_name
Email: $client_email
Phone: $client_phone
Address: $client_address

Message ID: $msg_id"

        log "Sending alert for service request from $client_name ($client_email)"
        send_whatsapp "$FRANK_CHAT_ID" "$alert_msg"

        # Add to escalation tracking
        add_escalation "service-$msg_id" "Service Request"

        # Send auto-reply if email available
        if [ -n "$client_email" ] && [ "$client_email" != "Unknown" ]; then
            log "Sending auto-reply to $client_email"

            local email_body="Thank you for contacting Flood Doctor. We have received your service request and will respond within 1 hour.

Our emergency response team is standing by 24/7 to help with:
- Water damage restoration
- Flood cleanup
- Mold remediation
- Fire and smoke damage
- Emergency board-up services

If this is an urgent matter, please call us directly at (703) 498-1581.

Best regards,
Frank
Flood Doctor LLC
frank@flood.doctor
(703) 498-1581"

            local raw_email="From: Frank - Flood Doctor <frank@flood.doctor>
To: $client_email
Subject: We Received Your Service Request
Content-Type: text/plain; charset=utf-8

$email_body"

            local encoded
            encoded=$(echo -e "$raw_email" | base64 | tr '+/' '-_' | tr -d '=' | tr -d '\n')

            gws gmail users messages send --params '{"userId":"me"}' --json "{\"raw\":\"$encoded\"}" 2>/dev/null || {
                log "Failed to send auto-reply to $client_email"
            }

            log "Auto-reply sent to $client_email"
        fi
    done

    # Update last processed ID
    if [ ${#new_ids[@]} -gt 0 ]; then
        echo "${new_ids[0]}" > "$SERVICE_LAST_ID"
        log "Updated last service request ID: ${new_ids[0]}"
    fi
}

# Main execution
log "========== Lead Watcher Run Started =========="

# Check for escalations first
check_escalations

# Process new leads
process_signpost_calls
process_service_requests

# Cleanup old escalations
cleanup_escalations

log "========== Lead Watcher Run Completed =========="
