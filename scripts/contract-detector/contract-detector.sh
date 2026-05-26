#!/bin/bash
set -euo pipefail

# Contract Detector for Flood Doctor LLC
# Detects signed e-sign contracts from Gmail and auto-creates Google Drive client folders

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="${ATLAS_PROJECT_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
LOG_FILE="$PROJECT_ROOT/workspace/task-queue/contract-detector.log"
STATE_FILE="$PROJECT_ROOT/workspace/task-queue/contract-detector-last-id.txt"
GATEWAY_URL="${GATEWAY_URL:-http://localhost:4096/api/send}"
GATEWAY_TOKEN="${GATEWAY_API_TOKEN:-$(grep '^GATEWAY_API_TOKEN=' "$PROJECT_ROOT/.env" 2>/dev/null | cut -d= -f2)}"
PARENT_FOLDER_ID="1mS6LDPy5s5Cck3_5lzaLRqdEo0gam5vG"
FRANK_CHAT_ID="17034981581@s.whatsapp.net"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
}

send_whatsapp() {
    local message="$1"
    curl -s -X POST "$GATEWAY_URL" \
        -H 'Content-Type: application/json' \
        -H "Authorization: Bearer $GATEWAY_TOKEN" \
        -d "{\"chat_id\":\"$FRANK_CHAT_ID\",\"message\":$(printf '%s' "$message" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')}" \
        >> "$LOG_FILE" 2>&1
}

log "=== Contract Detector Run ==="

# Ensure state file exists
mkdir -p "$(dirname "$STATE_FILE")"
touch "$STATE_FILE"

# Load last processed ID
LAST_ID=""
if [[ -f "$STATE_FILE" && -s "$STATE_FILE" ]]; then
    LAST_ID=$(cat "$STATE_FILE")
    log "Last processed ID: $LAST_ID"
fi

# Search for new signed contract emails
log "Searching for signed contract emails..."
MESSAGES_JSON=$(gws gmail users messages list --params '{"userId":"me","q":"from:noreply@flooddoctorva.com subject:\"Signed by\" is:unread","maxResults":5}' 2>/dev/null || echo '{}')

MESSAGE_IDS=$(echo "$MESSAGES_JSON" | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
    messages = data.get("messages", [])
    for msg in messages:
        print(msg["id"])
except:
    pass
')

if [[ -z "$MESSAGE_IDS" ]]; then
    log "No new signed contract emails found"
    exit 0
fi

log "Found $(echo "$MESSAGE_IDS" | wc -l | tr -d ' ') unread emails"

# Process each message
while IFS= read -r MSG_ID; do
    [[ -z "$MSG_ID" ]] && continue

    # Skip if already processed
    if [[ "$MSG_ID" == "$LAST_ID" ]]; then
        log "Skipping already processed message: $MSG_ID"
        continue
    fi

    log "Processing message: $MSG_ID"

    # Get full message details
    MESSAGE_DATA=$(gws gmail users messages get --params "{\"userId\":\"me\",\"id\":\"$MSG_ID\",\"format\":\"full\"}" 2>/dev/null || echo '{}')

    # Extract subject and parse client info
    PARSED=$(echo "$MESSAGE_DATA" | python3 -c '
import json, sys, re
try:
    data = json.load(sys.stdin)
    headers = data.get("payload", {}).get("headers", [])
    subject = ""
    for h in headers:
        if h["name"].lower() == "subject":
            subject = h["value"]
            break

    # Pattern: "esign - CLIENT NAME - Signed by CLIENT NAME email"
    match = re.search(r"esign\s*-\s*(.+?)\s*-\s*Signed by\s+(.+?)\s+([\w\.-]+@[\w\.-]+)", subject, re.IGNORECASE)
    if match:
        client_name = match.group(1).strip()
        email = match.group(3).strip()
        print(json.dumps({"client_name": client_name, "email": email}))
    else:
        print("{}")
except Exception as e:
    print("{}")
    sys.stderr.write(str(e))
')

    CLIENT_NAME=$(echo "$PARSED" | python3 -c 'import json, sys; data=json.load(sys.stdin); print(data.get("client_name", ""))')
    CLIENT_EMAIL=$(echo "$PARSED" | python3 -c 'import json, sys; data=json.load(sys.stdin); print(data.get("email", ""))')

    if [[ -z "$CLIENT_NAME" ]]; then
        log "Could not extract client name from message $MSG_ID"
        continue
    fi

    log "Client: $CLIENT_NAME <$CLIENT_EMAIL>"

    # Check if client folder exists
    log "Checking for existing client folder..."
    EXISTING_FOLDER=$(gws drive files list --params "{\"q\":\"name contains '$CLIENT_NAME' and '$PARENT_FOLDER_ID' in parents\",\"fields\":\"files(id,name)\"}" 2>/dev/null || echo '{}')

    FOLDER_ID=$(echo "$EXISTING_FOLDER" | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
    files = data.get("files", [])
    if files:
        print(files[0]["id"])
except:
    pass
')

    if [[ -n "$FOLDER_ID" ]]; then
        log "Client folder already exists: $FOLDER_ID"
    else
        log "Creating new client folder..."
        CREATE_RESULT=$(gws drive files create --params '{"fields":"id,name"}' --json "{\"name\":\"$CLIENT_NAME\",\"mimeType\":\"application/vnd.google-apps.folder\",\"parents\":[\"$PARENT_FOLDER_ID\"]}" 2>/dev/null || echo '{}')

        FOLDER_ID=$(echo "$CREATE_RESULT" | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
    print(data.get("id", ""))
except:
    pass
')

        if [[ -z "$FOLDER_ID" ]]; then
            log "ERROR: Failed to create client folder for $CLIENT_NAME"
            continue
        fi

        log "Created client folder: $FOLDER_ID"

        # Create subfolders
        for SUBFOLDER in "Documents" "Photos" "Invoices" "PM Notes"; do
            log "Creating subfolder: $SUBFOLDER"
            gws drive files create --params '{"fields":"id,name"}' --json "{\"name\":\"$SUBFOLDER\",\"mimeType\":\"application/vnd.google-apps.folder\",\"parents\":[\"$FOLDER_ID\"]}" 2>/dev/null >> "$LOG_FILE" || log "WARNING: Failed to create subfolder $SUBFOLDER"
        done

        log "Client folder structure created successfully"
    fi

    # Send WhatsApp notification
    WHATSAPP_MSG="📝 CONTRACT SIGNED: $CLIENT_NAME
Email: $CLIENT_EMAIL
Client folder created in Google Drive with subfolders."

    log "Sending WhatsApp notification..."
    send_whatsapp "$WHATSAPP_MSG"

    # Mark email as read
    log "Marking email as read..."
    gws gmail users messages modify --params "{\"userId\":\"me\",\"id\":\"$MSG_ID\"}" --json '{"removeLabelIds":["UNREAD"]}' 2>/dev/null >> "$LOG_FILE" || log "WARNING: Failed to mark email as read"

    # Update last processed ID
    echo "$MSG_ID" > "$STATE_FILE"

    log "Successfully processed contract for $CLIENT_NAME"

done <<< "$MESSAGE_IDS"

log "=== Contract Detector Run Complete ==="
